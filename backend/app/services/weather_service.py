import asyncio
import httpx
import logging
import random
import datetime
import math
import statistics
from typing import Dict, Any, List, Optional

from backend.app.storage.database import (
    get_db, 
    get_all_active_faults, 
    get_active_model_record, 
    get_station_qc_config,
    create_or_update_incident,
    resolve_open_incidents_for_station
)
from backend.app.services.training_service import training_service

logger = logging.getLogger("skyguard.weather_service")

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

class WeatherService:
    def __init__(self):
        self.live_state: Dict[str, Any] = {}
        self.is_running = False
        self._cached_base_readings: Dict[str, Dict[str, Any]] = {}

    async def poll_loop(self):
        self.is_running = True
        logger.info("Started Background Weather Poller.")
        async with httpx.AsyncClient() as client:
            while self.is_running:
                try:
                    await self._sync_fleet(client)
                except Exception as e:
                    logger.error(f"Error in weather polling loop: {e}")
                await asyncio.sleep(20)

    def stop(self):
        self.is_running = False

    async def _sync_fleet(self, client: httpx.AsyncClient):
        # 1. Get all stations
        stations = []
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM stations")
            stations = [dict(row) for row in cur.fetchall()]

        if not stations:
            return

        # 2. Fetch Open-Meteo for all stations
        lats = [str(st["latitude"]) for st in stations]
        lons = [str(st["longitude"]) for st in stations]
        
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": ",".join(lats),
            "longitude": ",".join(lons),
            "current": "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day",
            "timezone": "auto"
        }

        try:
            resp = await client.get(url, params=params, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            responses = data if isinstance(data, list) else [data]
            for i, station in enumerate(stations):
                st_id = station["station_id"]
                if i < len(responses):
                    st_data = responses[i]
                    self._cached_base_readings[st_id] = st_data.get("current", {})
        except Exception as e:
            logger.error(f"Failed to fetch from Open-Meteo: {e}")

        self.reevaluate(stations)

    def reevaluate(self, stations: Optional[List[Dict[str, Any]]] = None):
        if not stations:
            try:
                with get_db() as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT * FROM stations")
                    stations = [dict(row) for row in cur.fetchall()]
            except Exception as e:
                logger.error(f"[WEATHER SERVICE] Failed to query stations from database: {e}", exc_info=True)
                return

        if not stations:
            return

        try:
            active_faults = get_all_active_faults() or {}
        except Exception as e:
            logger.warning(f"[WEATHER SERVICE] Could not load active faults: {e}")
            active_faults = {}

        new_state = {}

        for station in stations:
            st_id = str(station["station_id"]).strip().upper()
            current = self._cached_base_readings.get(st_id, {})
            
            # Base Open-Meteo readings (fallback to nominal if not yet populated)
            temp = float(current.get("temperature_2m", 26.5))
            hum = float(current.get("relative_humidity_2m", 78.0))
            pres = float(current.get("surface_pressure", 1010.0))
            wind = float(current.get("wind_speed_10m", 10.0))
            rain = float(current.get("precipitation", 0.0))
            
            # Active Faults
            fault = active_faults.get(st_id)
            battery = 12.6 + (random.random() - 0.5) * 0.01
            signal = -72 + (1 if random.random() > 0.5 else -1) if random.random() > 0.8 else -72
            
            if fault:
                f_type = fault.get("fault_type")
                f_offset = float(fault.get("offset_val", 0.4) or 0.4)
                if f_type == "SPIKE":
                    temp += 8.5
                elif f_type == "DRIFT":
                    temp += f_offset
                elif f_type == "FLATLINE":
                    pass 
                elif f_type == "POWER":
                    battery = 10.8
                    signal = -98
                elif f_type == "STORM":
                    rain += 25.0
                    wind += 30.0
                    hum = 98.0
                    pres -= 8.0

            # Assemble Observation for ML Scoring
            observation = {
                "temp": temp,
                "hum": hum,
                "pres": pres,
                "wind": wind,
                "rain": rain,
                "hour": 12
            }

            # Level 1: Immutable Hard Physical QC Rules
            qc_state = "NORMAL"
            if temp < -50 or temp > 60 or hum < 0 or hum > 100 or pres < 800 or pres > 1200:
                qc_state = "SUSPECT"
            if battery < 11.0 or signal < -95:
                qc_state = "SUSPECT"
            
            # Level 2: Station-Specific Normal Envelope (Fallback gracefully if uncalibrated)
            qc_config = None
            try:
                qc_config = get_station_qc_config(st_id)
            except Exception as e:
                logger.warning(f"Could not load QC config for {st_id}: {e}")

            if qc_config and qc_state == "NORMAL":
                t_min = qc_config.get("temperature_normal_min")
                t_max = qc_config.get("temperature_normal_max")
                if t_min is not None and temp < float(t_min):
                    qc_state = "SUSPECT"
                if t_max is not None and temp > float(t_max):
                    qc_state = "SUSPECT"
                
                h_min = qc_config.get("humidity_normal_min")
                h_max = qc_config.get("humidity_normal_max")
                if h_min is not None and hum < float(h_min):
                    qc_state = "SUSPECT"
                if h_max is not None and hum > float(h_max):
                    qc_state = "SUSPECT"
                
                p_min = qc_config.get("pressure_normal_min")
                p_max = qc_config.get("pressure_normal_max")
                if p_min is not None and pres < float(p_min):
                    qc_state = "SUSPECT"
                if p_max is not None and pres > float(p_max):
                    qc_state = "SUSPECT"

                w_min = qc_config.get("wind_normal_min")
                w_max = qc_config.get("wind_normal_max")
                if w_min is not None and w_max is not None and float(w_max) > float(w_min):
                    if wind < float(w_min) or wind > float(w_max):
                        qc_state = "SUSPECT"

            # Level 3: Station-Specific Isolation Forest Scoring
            ml_result = None
            try:
                model_record = get_active_model_record(st_id)
                if model_record:
                    ml_result = training_service.score_observation(
                        station_id=st_id,
                        observation=observation
                    )
            except Exception as e:
                logger.error(f"ML Scoring failed for {st_id}: {e}")

            # Safe ML Fallback for untrained or non-modeled stations
            if not ml_result or not isinstance(ml_result, dict):
                ml_result = {
                    "station_id": st_id,
                    "has_model": False,
                    "model_id": None,
                    "model_version": None,
                    "status": "UNTRAINED",
                    "is_anomaly": False,
                    "anomaly_score": None,
                    "threshold": None
                }
            
            final_status = "NORMAL"
            if battery < 11.0 or signal < -95:
                final_status = "CRITICAL"
            elif (ml_result and ml_result.get("is_anomaly")) or qc_state == "SUSPECT":
                final_status = "ANOMALY"
            
            new_state[st_id] = {
                "station_id": st_id,
                "station_name": station.get("station_name", st_id),
                "region": station.get("region", "Region"),
                "elevation": float(station.get("elevation", 0) or 0),
                "latitude": float(station["latitude"]),
                "longitude": float(station["longitude"]),
                "status": final_status,
                "battery": battery,
                "signal": signal,
                "last_seen": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sensors": {
                    "temperature": {"value": round(float(temp), 1), "unit": "°C"},
                    "humidity": {"value": round(float(hum), 1), "unit": "%"},
                    "pressure": {"value": round(float(pres), 1), "unit": "hPa"},
                    "wind_speed": {"value": round(float(wind), 1), "unit": "km/h"},
                    "rainfall": {"value": round(float(rain), 1), "unit": "mm"},
                },
                "ml_model": ml_result,
                "has_active_fault": fault is not None,
                "fault_details": fault,
                "spatial_data": {}
            }

        # Second Pass: Spatial Consensus & Peer Adjudication
        # Second Pass: Spatial Consensus, QC & Incident Adjudication
        for st_id, state in new_state.items():
            nearby_stations = []
            for other_id, other_state in new_state.items():
                if st_id == other_id:
                    continue
                dist = haversine_distance(
                    state["latitude"], state["longitude"],
                    other_state["latitude"], other_state["longitude"]
                )
                if dist <= 60.0:
                    nearby_stations.append({
                        "id": other_state["station_id"],
                        "station_id": other_state["station_id"],
                        "name": other_state["station_name"],
                        "region": other_state.get("region", "Region"),
                        "elevation": other_state.get("elevation", 0),
                        "distance_km": round(float(dist), 2),
                        "temp": other_state["sensors"]["temperature"]["value"],
                        "temperature": other_state["sensors"]["temperature"]["value"],
                        "hum": other_state["sensors"]["humidity"]["value"],
                        "status": other_state["status"]
                    })
            
            # Sort by distance
            nearby_stations.sort(key=lambda x: x["distance_km"])
            
            # 1. Evaluate QC Evidence Early
            qc_conf = None
            try:
                qc_conf = get_station_qc_config(st_id)
            except Exception as err:
                logger.warning(f"Could not fetch QC config for incident creation on {st_id}: {err}")

            obs_temp = float(state["sensors"]["temperature"]["value"])
            qc_envelope_breached = False
            if qc_conf:
                t_min = qc_conf.get("temperature_normal_min")
                t_max = qc_conf.get("temperature_normal_max")
                if (t_min is not None and obs_temp < float(t_min)) or (t_max is not None and obs_temp > float(t_max)):
                    qc_envelope_breached = True

            # 2. Spatial Consensus Logic & Evaluation (Safe Fallbacks when isolated)
            median_temp = None
            residual = None
            spatially_consistent = None
            peer_anomaly_ratio = 0.0

            if nearby_stations:
                peer_temps = [float(p["temp"]) for p in nearby_stations if p.get("temp") is not None]
                if peer_temps:
                    median_temp = statistics.median(peer_temps)
                    curr_temp = float(state["sensors"]["temperature"]["value"])
                    residual = abs(curr_temp - median_temp)
                    spatially_consistent = (residual <= 3.0)
                
                anomalous_peers = [p for p in nearby_stations if p.get("status") in ["ANOMALY", "CRITICAL", "REGIONAL_EVENT", "LOCALIZED_ANOMALY"]]
                peer_anomaly_ratio = len(anomalous_peers) / len(nearby_stations)
                
                # Spatial Adjudication: only adjudicate true anomalies when peers exist
                if state["status"] == "ANOMALY":
                    if spatially_consistent or peer_anomaly_ratio >= 0.4:
                        state["status"] = "REGIONAL_EVENT"
                    else:
                        state["status"] = "LOCALIZED_ANOMALY"

            state["spatial_data"] = {
                "search_radius_km": 60.0,
                "nearby_stations": nearby_stations,
                "eligible_peer_count": len(nearby_stations),
                "fleet_station_count": len(new_state),
                "spatial_analysis": {
                    "neighborhood_median_temp": round(float(median_temp), 1) if median_temp is not None else None,
                    "spatial_deviation_score": round(float(residual), 2) if residual is not None else 0.0,
                    "spatially_consistent": spatially_consistent if spatially_consistent is not None else None,
                    "peer_anomaly_ratio": round(float(peer_anomaly_ratio), 2)
                }
            }

            classification = state["status"]
            
            # Confidence logic based on multi-source evidence
            confidence = "MEDIUM"
            if classification in ["CRITICAL", "SUSPECT"]:
                confidence = "HIGH"
            elif classification == "LOCALIZED_ANOMALY" and len(nearby_stations) > 0:
                confidence = "HIGH"
            elif classification == "REGIONAL_EVENT" and len(nearby_stations) > 0:
                confidence = "HIGH"
            elif classification == "ANOMALY":
                if len(nearby_stations) == 0:
                    confidence = "LOW"
                elif qc_envelope_breached:
                    confidence = "MEDIUM"

            interpretation = "Nominal operations."
            badge_class = "badge-normal"
            
            if classification == "REGIONAL_EVENT":
                interpretation = "Anomaly corroborated by neighborhood peers, confirming a regional meteorological event."
                badge_class = "badge-extreme"
            elif classification == "LOCALIZED_ANOMALY":
                interpretation = "Target reading is anomalous and contradicts nearby station observations, indicating a localized anomaly."
                badge_class = "badge-critical"
            elif classification == "ANOMALY":
                interpretation = "ML model detected an anomalous reading. Sensor QC is within the station's normal envelope, and no nearby stations are available for spatial validation. Further operator verification is required."
                badge_class = "badge-critical"
            elif classification == "SUSPECT":
                interpretation = "Sensor reading flagged by physical QC limits."
                badge_class = "badge-suspect"
            elif classification == "CRITICAL":
                interpretation = "Critical hardware fault or physically impossible sensor telemetry detected."
                badge_class = "badge-critical"

            state["final_assessment"] = {
                "classification": classification,
                "confidence": confidence,
                "interpretation": interpretation,
                "badge_class": badge_class
            }

            # -----------------------------------------------------------------
            # Automated Backend Incident Lifecycle Management (Non-Crashing)
            # -----------------------------------------------------------------
            try:
                fault = state.get("fault_details")
                ml_res = state.get("ml_model")
                
                if classification in ["LOCALIZED_ANOMALY", "REGIONAL_EVENT", "ANOMALY", "CRITICAL", "SUSPECT"]:
                    reasons = []
                    if ml_res and ml_res.get("is_anomaly"):
                        score_val = ml_res.get("anomaly_score")
                        score_str = f"{round(float(score_val), 3)}" if score_val is not None else "DETECTED"
                        reasons.append(f"ML_SCORE_{score_str}")
                    if qc_envelope_breached:
                        reasons.append("QC_ENVELOPE_BREACH")
                    if classification == "LOCALIZED_ANOMALY":
                        reasons.append("SPATIAL_DISCORDANCE")
                    elif classification == "REGIONAL_EVENT":
                        reasons.append("REGIONAL_CLUSTER_CONSENSUS")
                    if not reasons:
                        reasons.append("PHYSICAL_QC_THRESHOLD_BREACH")

                    var_name = "air_temperature"
                    if fault and fault.get("fault_type") == "STORM":
                        var_name = "precipitation"
                    elif fault and fault.get("fault_type") == "POWER":
                        var_name = "battery_voltage"

                    exp = interpretation
                    if ml_res and ml_res.get("is_anomaly"):
                        score_str = f"{round(float(ml_res.get('anomaly_score', 0)), 3)}" if ml_res.get("anomaly_score") is not None else "N/A"
                        thresh_str = f"{round(float(ml_res.get('threshold', 0)), 3)}" if ml_res.get("threshold") is not None else "N/A"
                        exp += f" Isolation Forest score ({score_str}) crossed model threshold ({thresh_str})."

                    # Assemble Three Independent Evidence Factors for Transparent Adjudication
                    # 1. Model Prediction Evidence
                    model_prediction = {
                        "has_model": bool(ml_res.get("has_model", False)) if ml_res else False,
                        "model_id": ml_res.get("model_id") if ml_res else None,
                        "model_version": ml_res.get("model_version") if ml_res else None,
                        "anomaly_score": round(float(ml_res["anomaly_score"]), 3) if (ml_res and ml_res.get("anomaly_score") is not None) else None,
                        "threshold": round(float(ml_res["threshold"]), 3) if (ml_res and ml_res.get("threshold") is not None) else None,
                        "status": ml_res.get("status", "UNTRAINED") if ml_res else "UNTRAINED",
                        "is_anomaly": bool(ml_res.get("is_anomaly", False)) if ml_res else False,
                    }

                    # 2. Nearby Station Evidence (Spatial Consensus)
                    closest_peer = nearby_stations[0] if nearby_stations else None
                    peer_st_id = None
                    if closest_peer:
                        candidate_id = closest_peer.get("station_id") or closest_peer.get("id")
                        if candidate_id and candidate_id != st_id:
                            peer_st_id = candidate_id

                    spatial_evidence = {
                        "search_radius_km": 60.0,
                        "eligible_peer_count": len(nearby_stations),
                        "closest_peer": {
                            "station_id": peer_st_id,
                            "station_name": closest_peer.get("name"),
                            "distance_km": round(float(closest_peer.get("distance_km", 0.0)), 2),
                            "temperature": closest_peer.get("temp"),
                            "status": closest_peer.get("status")
                        } if (closest_peer and peer_st_id) else None,
                        "target_temperature": round(float(state["sensors"]["temperature"]["value"]), 1),
                        "neighborhood_median_temp": round(float(median_temp), 1) if median_temp is not None else None,
                        "spatial_deviation": round(float(residual), 2) if residual is not None else 0.0,
                        "spatial_result": "CONTRADICTED" if spatially_consistent is False else ("CONSISTENT" if spatially_consistent is True else "UNAVAILABLE"),
                        "summary": "Neighborhood contradicts reading" if spatially_consistent is False else ("Validated by peers" if spatially_consistent is True else "No nearby stations available within 60 km radius. Spatial validation unavailable.")
                    }

                    # 3. Sensor / QC Evidence
                    q_min = qc_conf.get("temperature_normal_min") if qc_conf else None
                    q_max = qc_conf.get("temperature_normal_max") if qc_conf else None
                    sensor_qc_evidence = {
                        "variable": var_name,
                        "observed_value": obs_temp,
                        "unit": state["sensors"]["temperature"]["unit"],
                        "station_normal_min": round(float(q_min), 2) if q_min is not None else None,
                        "station_normal_max": round(float(q_max), 2) if q_max is not None else None,
                        "qc_result": "OUTSIDE_NORMAL_ENVELOPE" if qc_envelope_breached else "WITHIN_NORMAL_ENVELOPE",
                        "physical_qc": "SUSPECT" if (state["battery"] < 11.0 or state["signal"] < -95 or obs_temp < -50 or obs_temp > 60) else "PASS",
                        "fault_state": f"{fault.get('fault_type')} INJECTED" if fault else "NONE_DETECTED",
                        "fault_type": fault.get("fault_type") if fault else None,
                        "battery": round(float(state["battery"]), 2),
                        "signal": round(float(state["signal"]), 1)
                    }

                    evidence_data = {
                        "model_prediction": model_prediction,
                        "spatial_evidence": spatial_evidence,
                        "sensor_qc_evidence": sensor_qc_evidence,
                        "final_assessment": {
                            "classification": classification,
                            "confidence": confidence,
                            "interpretation": interpretation,
                            "badge_class": badge_class
                        }
                    }

                    if len(nearby_stations) == 0:
                        recommended_actions = [
                            "Perform local sensor and hardware verification",
                            "Review station telemetry history",
                            "Await additional observations or nearby spatial evidence"
                        ]
                        peer_action = "N/A"
                    else:
                        peer_action = (
                            f"Validate reading against nearest spatial peer network ({peer_st_id})"
                            if peer_st_id
                            else "Validate reading against regional peer network"
                        )
                        recommended_actions = [
                            "Inspect sensor radiation shield and terminal connections",
                            peer_action,
                            "Check hardware battery voltage and telemetry signal stability"
                        ]

                    fault_risk_val = 0.85
                    if ml_res and ml_res.get("anomaly_score") is not None:
                        fault_risk_val = float(ml_res["anomaly_score"])
                    elif classification == "CRITICAL":
                        fault_risk_val = 0.95

                    inc_payload = {
                        "station_id": st_id,
                        "station_name": state["station_name"],
                        "variable": var_name,
                        "severity": "critical" if classification in ["CRITICAL", "LOCALIZED_ANOMALY"] else "high",
                        "fault_risk": round(fault_risk_val, 2),
                        "quality_state": classification,
                        "reason_codes": reasons,
                        "explanation": exp,
                        "recommended_actions": recommended_actions,
                        "evidence_ids": [f"EV-{st_id}-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')}"],
                        "evidence_data": evidence_data
                    }
                    create_or_update_incident(inc_payload)
                    logger.info(f"[INCIDENT] Recorded/updated active incident for {st_id} ({classification}) with peer action: '{peer_action}'")
                elif classification == "NORMAL":
                    resolved_count = resolve_open_incidents_for_station(st_id)
                    if resolved_count > 0:
                        logger.info(f"[INCIDENT] Auto-resolved {resolved_count} incident(s) for {st_id} on telemetry return to normal")
            except Exception as e:
                logger.error(f"[INCIDENT LIFECYCLE ERROR] Failed to process incident lifecycle for {st_id}: {e}", exc_info=True)

        self.live_state = new_state

    def get_fleet_state(self) -> List[Dict[str, Any]]:
        if not self.live_state:
            try:
                self.reevaluate()
            except Exception as e:
                logger.error(f"[WEATHER SERVICE] Error evaluating initial fleet state: {e}", exc_info=True)
        return list(self.live_state.values())

    async def sync_now(self):
        async with httpx.AsyncClient() as client:
            await self._sync_fleet(client)

weather_service = WeatherService()

