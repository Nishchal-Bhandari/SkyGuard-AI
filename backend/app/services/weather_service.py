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
    fetch_historical_telemetry,
    create_or_update_incident,
    resolve_open_incidents_for_station,
    persist_assessment
)
from backend.app.services.training_service import training_service

# Import Enhanced SkyGuard ML & Physics Engines
from ml.thermo_engine import thermo_engine
from ml.root_cause_classifier import root_cause_classifier
from ml.imputation_engine import imputation_engine
from ml.sensor_health import sensor_health_engine

logger = logging.getLogger("skyguard.weather_service")

# ---------------------------------------------------------------------------
# Envelope Tolerance / Hysteresis Constants
# ---------------------------------------------------------------------------
# A reading within SOFT_MARGIN of the envelope boundary is treated as WMO 1
# (SUSPECT) only.  WMO 2 (ERRONEOUS) is reserved for hard physical-bound
# violations and confirmed spatial outliers (residual > SPATIAL_ERRONEOUS_K).
TEMP_SOFT_MARGIN   = 0.5   # °C  — sensor accuracy spec ± 0.3 °C + 0.2 °C guard
HUM_SOFT_MARGIN    = 2.0   # %RH — sensor accuracy spec ± 1.5 %
PRES_SOFT_MARGIN   = 1.5   # hPa — sensor accuracy spec ± 1 hPa + 0.5 hPa guard
SPATIAL_ERRONEOUS_K = 5.0 # °C  — spatial residual threshold for WMO 2 upgrade


def station_readiness(station_id: str) -> Dict[str, Any]:
    """Return an explicit readiness tier from distinct historical observations."""
    rows = fetch_historical_telemetry(station_id, limit=5000)
    days = {str(row.get("timestamp", ""))[:10] for row in rows if row.get("timestamp")}
    count = len(rows)
    if count < 72:
        tier = "COLD_START"
    elif count < 720:
        tier = "BASELINE"
    elif count >= 4380 and len(days) >= 180:
        tier = "MATURE"
    else:
        tier = "TRAINED" if len(days) >= 14 else "BASELINE"
    return {"tier": tier, "observation_count": count, "distinct_days": len(days)}


def fuse_anomaly_evidence(evidence: Dict[str, float]) -> Dict[str, Any]:
    """Combine evidence with fitted coefficients if available, else fallback to priors."""
    coefficients = {
        "intercept": -2.0,
        "z_qc": 1.1,
        "z_phys": 1.5,
        "z_temp": 1.0,
        "z_ml": 1.2,
        "z_multi": 0.8,
        "z_health": 0.6,
    }
    status_label = "DEFAULT_PRIORS"
    
    try:
        from backend.app.storage.database import get_db
        import json
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT coefficients, status FROM fusion_coefficients ORDER BY id DESC LIMIT 1")
            row = cursor.fetchone()
            if row:
                db_coeffs = json.loads(row["coefficients"])
                if db_coeffs:
                    coefficients.update(db_coeffs)
                    status_label = row["status"]
    except Exception as e:
        pass

    logit = coefficients.get("intercept", -2.0)
    terms = {}
    for key, weight in coefficients.items():
        if key == "intercept":
            continue
        contribution = round(weight * float(evidence.get(key, 0.0) or 0.0), 4)
        terms[key] = contribution
        logit += contribution
    probability_like = round(1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, logit)))), 4)
    return {
        "score": probability_like,
        "logit": round(logit, 4),
        "terms": terms,
        "coefficient_status": status_label,
        "calibration_note": "Fitted logistic probabilities." if status_label != "DEFAULT_PRIORS" else "Not a validated real-world probability until fitted and reliability-tested.",
    }

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

    @staticmethod
    def _temporal_evidence(current: Dict[str, float], previous: Optional[Dict[str, float]]) -> Dict[str, Any]:
        if not previous:
            return {"available": False, "spike": False, "rate_of_change": 0.0, "noise": False}
        delta_temp = current["temp"] - previous.get("temp", current["temp"])
        delta_hum = current["hum"] - previous.get("hum", current["hum"])
        delta_pres = current["pres"] - previous.get("pres", current["pres"])
        return {
            "available": True,
            "spike": abs(delta_temp) >= 6.0,
            "rate_of_change": round(abs(delta_temp), 3),
            "humidity_rate": round(abs(delta_hum), 3),
            "pressure_rate": round(abs(delta_pres), 3),
            "noise": abs(delta_temp) >= 3.0 and abs(delta_hum) >= 8.0,
        }

    @staticmethod
    def _multivariate_evidence(temp: float, hum: float, pres: float, rain: float, wind: float) -> Dict[str, Any]:
        violations = []
        if hum >= 98.0 and rain <= 0.0 and wind < 2.0:
            violations.append("HUMIDITY_WEATHER_INCOHERENCE")
        if pres < 850.0 or pres > 1100.0:
            violations.append("PRESSURE_CONTEXT_OUTLIER")
        return {"valid": not violations, "violations": violations}

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

        await asyncio.to_thread(self.reevaluate, stations)


    def reevaluate(self, stations: Optional[List[Dict[str, Any]]] = None):
        try:
            with get_db() as conn:
                cur = conn.cursor()
                if not stations:
                    cur.execute("SELECT * FROM stations")
                    stations = [dict(row) for row in cur.fetchall()]

                cur.execute("SELECT * FROM active_faults")
                active_faults = {str(r["station_id"]).strip().upper(): dict(r) for r in cur.fetchall()}

                cur.execute("SELECT * FROM station_qc_config")
                all_qc_configs = {str(r["station_id"]).strip().upper(): dict(r) for r in cur.fetchall()}

                cur.execute("SELECT * FROM model_registry WHERE status = 'ACTIVE' ORDER BY id DESC")
                all_models = {}
                for r in cur.fetchall():
                    sid = str(r["station_id"]).strip().upper()
                    if sid not in all_models:
                        all_models[sid] = dict(r)
        except Exception as e:
            logger.error(f"[WEATHER SERVICE] Failed to query fleet metadata from database: {e}", exc_info=True)
            return

        if not stations:
            return

        new_state = {}

        # First Pass: Compute Physical & Thermodynamic QC, ML Scoring, and Local Health
        for station in stations:
            st_id = str(station["station_id"]).strip().upper()
            current = self._cached_base_readings.get(st_id, {})
            elev = float(station.get("elevation", 0) or 0)
            readiness = station_readiness(st_id)
            
            # Base Open-Meteo readings (fallback to nominal if not yet populated)
            temp = float(current.get("temperature_2m", 26.5))
            hum = float(current.get("relative_humidity_2m", 78.0))
            pres = float(current.get("surface_pressure", 1010.0))
            wind = float(current.get("wind_speed_10m", 10.0))
            rain = float(current.get("precipitation", 0.0))
            
            # Active Faults Injection Simulation
            fault = active_faults.get(st_id)
            battery = 12.6 + (random.random() - 0.5) * 0.01
            signal = -72 + (1 if random.random() > 0.5 else -1) if random.random() > 0.8 else -72
            drift_rate = 0.0
            is_flatline = False
            
            if fault:
                f_type = fault.get("fault_type")
                f_offset = float(fault.get("offset_val", 0.4) or 0.4)
                if f_type == "SPIKE":
                    temp += 8.5
                elif f_type == "DRIFT":
                    temp += f_offset
                    drift_rate = f_offset / 3.0
                elif f_type == "FLATLINE":
                    temp = 24.0
                    hum = 60.0
                    pres = 1013.2
                    is_flatline = True
                elif f_type == "POWER":
                    battery = 10.8
                    signal = -98
                elif f_type == "STORM":
                    rain += 25.0
                    wind += 30.0
                    hum = 98.0
                    pres -= 8.0
                elif f_type == "RH_SUPERSAT":
                    hum = 105.0 + f_offset
                elif f_type == "SENTINEL":
                    temp = -999.0
                    hum = 65535.0
                    pres = -999.0
                elif f_type == "MISSING":
                    temp = None
                    hum = None
                    pres = None
                elif f_type == "PRESSURE_OFFSET":
                    pres += 15.0 + f_offset
                elif f_type == "NOISE_BURST":
                    temp += (random.random() - 0.5) * 20.0
                    hum += (random.random() - 0.5) * 40.0
                    pres += (random.random() - 0.5) * 30.0
                elif f_type == "COMMS_DROPOUT":
                    temp = None
                    hum = None
                    pres = None
                    signal = -110
                elif f_type == "SEA_BREEZE":
                    temp -= 6.0
                    hum += 15.0
                    wind += 12.0
                    
            # L1 Sentinel / Missing Data Handling
            is_missing = temp is None or hum is None or pres is None
            is_sentinel = not is_missing and (temp <= -900 or hum >= 65000 or pres <= -900)
            
            if is_missing or is_sentinel:
                # Force dummy safe values for pipeline continuation, flag as suspect
                temp = temp if (temp is not None and not is_sentinel) else 25.0
                hum = hum if (hum is not None and not is_sentinel) else 65.0
                pres = pres if (pres is not None and not is_sentinel) else 1013.25

            # Level 1: Thermodynamic & Physical Bounds Verification
            thermo_valid, thermo_violations = thermo_engine.validate_thermodynamic_bounds(temp, pres, hum, elev)
            derived_thermo = thermo_engine.compute_all_thermodynamic_features(temp, pres, hum, elev)

            # Assemble Observation for ML Scoring
            observation = {
                "temp": temp,
                "hum": hum,
                "pres": pres,
                "wind": wind,
                "rain": rain,
                "hour": 12
            }
            previous_state = self.live_state.get(st_id, {})
            previous_sensors = previous_state.get("sensors", {})
            previous_observation = {
                "temp": previous_sensors.get("temperature", {}).get("value", temp),
                "hum": previous_sensors.get("humidity", {}).get("value", hum),
                "pres": previous_sensors.get("pressure", {}).get("value", pres),
            }
            temporal_evidence = self._temporal_evidence(
                {"temp": temp, "hum": hum, "pres": pres},
                previous_observation if previous_state else None
            )
            multivariate_evidence = self._multivariate_evidence(temp, hum, pres, rain, wind)

            # WMO Flag defaults: 0 (Good), 1 (Suspect), 2 (Erroneous), 3 (Imputed)
            wmo_t_flag = 0
            wmo_h_flag = 0
            wmo_p_flag = 0

            # Level 2: Immutable Hard Physical QC Rules
            qc_state = "NORMAL"
            if not thermo_valid or temp < -50 or temp > 60 or hum < 0 or hum > 100 or pres < 800 or pres > 1200 or is_missing or is_sentinel:
                qc_state = "SUSPECT"
                if temp < -50 or temp > 60 or is_missing or is_sentinel:
                    wmo_t_flag = 2 if not (is_missing or is_sentinel) else 1
                if hum < 0 or hum > 100 or is_missing or is_sentinel:
                    wmo_h_flag = 2 if not (is_missing or is_sentinel) else 1
                if pres < 800 or pres > 1200 or is_missing or is_sentinel:
                    wmo_p_flag = 2 if not (is_missing or is_sentinel) else 1

            if battery < 11.0 or signal < -95 or is_flatline:
                qc_state = "SUSPECT"
                if is_flatline:
                    wmo_t_flag, wmo_h_flag, wmo_p_flag = 1, 1, 1
            
            # Level 3: Station-Specific Normal Envelope (with hysteresis / tolerance band)
            # Soft margin: readings within TEMP_SOFT_MARGIN of the boundary edge → WMO 1 (SUSPECT)
            # Hard breach: readings outside envelope by more than the soft margin → WMO 1 still;
            #              WMO 2 (ERRONEOUS) is only assigned by Level 2 (physical bounds) or
            #              spatial consensus below — never by a statistical envelope alone.
            qc_config = all_qc_configs.get(st_id)

            if qc_config and qc_state == "NORMAL":
                t_min = qc_config.get("temperature_normal_min")
                t_max = qc_config.get("temperature_normal_max")
                # Apply soft margin: breach the inner band (envelope ± TEMP_SOFT_MARGIN) before flagging
                t_breached = (
                    (t_min is not None and temp < float(t_min) - TEMP_SOFT_MARGIN) or
                    (t_max is not None and temp > float(t_max) + TEMP_SOFT_MARGIN)
                )
                if t_breached:
                    qc_state = "SUSPECT"
                    wmo_t_flag = 1  # WMO 1 — SUSPECT; WMO 2 reserved for hard physical violations

                h_min = qc_config.get("humidity_normal_min")
                h_max = qc_config.get("humidity_normal_max")
                h_breached = (
                    (h_min is not None and hum < float(h_min) - HUM_SOFT_MARGIN) or
                    (h_max is not None and hum > float(h_max) + HUM_SOFT_MARGIN)
                )
                if h_breached:
                    qc_state = "SUSPECT"
                    wmo_h_flag = 1

                p_min = qc_config.get("pressure_normal_min")
                p_max = qc_config.get("pressure_normal_max")
                p_breached = (
                    (p_min is not None and pres < float(p_min) - PRES_SOFT_MARGIN) or
                    (p_max is not None and pres > float(p_max) + PRES_SOFT_MARGIN)
                )
                if p_breached:
                    qc_state = "SUSPECT"
                    wmo_p_flag = 1

            # Level 4: Station-Specific Isolation Forest Scoring + TreeSHAP
            ml_result = None
            try:
                model_record = all_models.get(st_id)
                if model_record and readiness["tier"] in ["TRAINED", "MATURE"]:
                    ml_result = training_service.score_observation(
                        station_id=st_id,
                        observation=observation,
                        last_observation=previous_observation if previous_state else None
                    )
            except Exception as e:
                logger.error(f"ML Scoring failed for {st_id}: {e}")

            # Safe ML Fallback for untrained stations
            if not ml_result or not isinstance(ml_result, dict):
                ml_result = {
                    "station_id": st_id,
                    "has_model": False,
                    "model_id": None,
                    "model_version": None,
                    "status": "UNTRAINED",
                    "is_anomaly": False,
                    "anomaly_score": None,
                    "threshold": None,
                    "xai_explanation": None
                }
            
            final_status = "NORMAL"
            if battery < 11.0 or signal < -95 or (not thermo_valid) or (fault and fault.get("fault_type") == "POWER"):
                final_status = "CRITICAL"
                wmo_t_flag = max(wmo_t_flag, 2 if not thermo_valid else 1)
            elif (ml_result and ml_result.get("is_anomaly")) or qc_state == "SUSPECT" or fault is not None:
                final_status = "ANOMALY"
                if fault:
                    f_type = fault.get("fault_type")
                    if f_type == "SPIKE":
                        wmo_t_flag = 2
                    elif f_type == "DRIFT":
                        wmo_t_flag = 1
                    elif f_type == "FLATLINE":
                        wmo_t_flag, wmo_h_flag, wmo_p_flag = 1, 1, 1
                    elif f_type == "STORM":
                        wmo_p_flag = 1
                elif ml_result and ml_result.get("is_anomaly") and wmo_t_flag == 0:
                    wmo_t_flag = 1
            
            new_state[st_id] = {
                "station_id": st_id,
                "station_name": station.get("station_name", st_id),
                "region": station.get("region", "Region"),
                "elevation": elev,
                "latitude": float(station["latitude"]),
                "longitude": float(station["longitude"]),
                "status": final_status,
                "battery": battery,
                "signal": signal,
                "last_seen": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sensors": {
                    "temperature": {"value": round(float(temp), 1), "unit": "°C", "wmo_flag": wmo_t_flag, "status": "FLAG_GOOD" if wmo_t_flag == 0 else ("FLAG_SUSPECT" if wmo_t_flag == 1 else "FLAG_ERRONEOUS")},
                    "humidity": {"value": round(float(hum), 1), "unit": "%", "wmo_flag": wmo_h_flag, "status": "FLAG_GOOD" if wmo_h_flag == 0 else ("FLAG_SUSPECT" if wmo_h_flag == 1 else "FLAG_ERRONEOUS")},
                    "pressure": {"value": round(float(pres), 1), "unit": "hPa", "wmo_flag": wmo_p_flag, "status": "FLAG_GOOD" if wmo_p_flag == 0 else ("FLAG_SUSPECT" if wmo_p_flag == 1 else "FLAG_ERRONEOUS")},
                    "wind_speed": {"value": round(float(wind), 1), "unit": "km/h", "wmo_flag": 0},
                    "rainfall": {"value": round(float(rain), 1), "unit": "mm", "wmo_flag": 0},
                },
                "derived_thermodynamics": derived_thermo,
                "thermodynamic_violations": thermo_violations,
                "ml_model": ml_result,
                "has_active_fault": fault is not None,
                "fault_details": fault,
                "drift_rate": drift_rate,
                "is_flatline": is_flatline,
                "spatial_data": {}
            }
            new_state[st_id]["readiness"] = readiness
            new_state[st_id]["temporal_evidence"] = temporal_evidence
            new_state[st_id]["multivariate_evidence"] = multivariate_evidence

        # Second Pass: Spatial Consensus, Root-Cause Classification, Imputation & Health
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
                        "pres": other_state["sensors"]["pressure"]["value"],
                        "status": other_state["status"]
                    })
            
            # Sort by distance and retain closest peers
            nearby_stations.sort(key=lambda x: x["distance_km"])
            nearby_stations = nearby_stations[:5]
            
            # QC Evaluation
            qc_conf = all_qc_configs.get(st_id)
            obs_temp = float(state["sensors"]["temperature"]["value"])
            obs_hum  = float(state["sensors"]["humidity"]["value"])
            obs_pres = float(state["sensors"]["pressure"]["value"])

            qc_violations: list = []
            qc_envelope_breached = False

            if state.get("is_flatline"):
                qc_envelope_breached = True
                qc_violations.append({
                    "parameter": "temperature",
                    "value": obs_temp,
                    "unit": "°C",
                    "reason": "FLATLINE_DETECTED"
                })

            if qc_conf:
                t_min = qc_conf.get("temperature_normal_min")
                t_max = qc_conf.get("temperature_normal_max")
                # Use the same soft-margin tolerance as Level 3 QC to keep reporting consistent
                t_soft_breach = (
                    (t_min is not None and obs_temp < float(t_min) - TEMP_SOFT_MARGIN) or
                    (t_max is not None and obs_temp > float(t_max) + TEMP_SOFT_MARGIN)
                )
                # Report any breach (including inner soft band) for diagnostics, but flag only hard breaches
                t_inner_breach = (
                    (t_min is not None and obs_temp < float(t_min)) or
                    (t_max is not None and obs_temp > float(t_max))
                )
                if t_inner_breach:
                    qc_envelope_breached = True
                    excess = round(
                        max(
                            (obs_temp - float(t_max)) if t_max is not None else 0,
                            (float(t_min) - obs_temp) if t_min is not None else 0
                        ), 3
                    )
                    qc_violations.append({
                        "parameter": "temperature", "value": obs_temp,
                        "normal_min": round(float(t_min), 2) if t_min is not None else None,
                        "normal_max": round(float(t_max), 2) if t_max is not None else None,
                        "soft_margin": TEMP_SOFT_MARGIN,
                        "excess_delta": excess,
                        "hard_breach": t_soft_breach,
                        "unit": "°C", "reason": "outside_station_normal_envelope"
                    })

                h_min = qc_conf.get("humidity_normal_min")
                h_max = qc_conf.get("humidity_normal_max")
                h_inner_breach = (
                    (h_min is not None and obs_hum < float(h_min)) or
                    (h_max is not None and obs_hum > float(h_max))
                )
                if h_inner_breach:
                    qc_envelope_breached = True
                    qc_violations.append({
                        "parameter": "humidity", "value": obs_hum,
                        "normal_min": round(float(h_min), 2) if h_min is not None else None,
                        "normal_max": round(float(h_max), 2) if h_max is not None else None,
                        "soft_margin": HUM_SOFT_MARGIN,
                        "unit": "%", "reason": "outside_station_normal_envelope"
                    })

                p_min = qc_conf.get("pressure_normal_min")
                p_max = qc_conf.get("pressure_normal_max")
                p_inner_breach = (
                    (p_min is not None and obs_pres < float(p_min)) or
                    (p_max is not None and obs_pres > float(p_max))
                )
                if p_inner_breach:
                    qc_envelope_breached = True
                    qc_violations.append({
                        "parameter": "pressure", "value": obs_pres,
                        "normal_min": round(float(p_min), 2) if p_min is not None else None,
                        "normal_max": round(float(p_max), 2) if p_max is not None else None,
                        "soft_margin": PRES_SOFT_MARGIN,
                        "unit": "hPa", "reason": "outside_station_normal_envelope"
                    })

            # Spatial Consensus Logic (Phase 3: Residual Space)
            from ml.spatial_engine import SpatialIntelligenceEngine
            spatial_engine = SpatialIntelligenceEngine()
            
            # Pre-compute target z_T
            target_ml = state.get("ml_model")
            if target_ml and "feature_vector" in target_ml and len(target_ml["feature_vector"]) > 0:
                state["z_T"] = target_ml["feature_vector"][0]
            else:
                state["z_T"] = 0.0
                
            # Pre-compute peer z_T
            for p in nearby_stations:
                peer_ml = p.get("ml_model")
                if peer_ml and "feature_vector" in peer_ml and len(peer_ml["feature_vector"]) > 0:
                    p["z_T"] = peer_ml["feature_vector"][0]
                else:
                    p["z_T"] = 0.0
            
            spatial_analysis_dict = spatial_engine.compute_spatial_deviation(
                target_station=state, 
                nearby_stations=nearby_stations
            )
            
            spatially_consistent = spatial_analysis_dict.get("spatially_consistent", True)
            residual = spatial_analysis_dict.get("spatial_deviation_score", 0.0)
            agreement_index = spatial_analysis_dict.get("agreement_index", 1.0)
            peer_anomaly_ratio = spatial_analysis_dict.get("peer_anomaly_ratio", 0.0)
            
            if state["status"] in ["ANOMALY", "SUSPECT"] or (agreement_index < 0.01):
                if agreement_index >= 0.32 and spatially_consistent:
                    state["status"] = "SPATIALLY_VALIDATED"
                elif len(nearby_stations) >= 2 and (spatially_consistent or peer_anomaly_ratio >= 0.4):
                    state["status"] = "REGIONAL_EVENT"
                elif len(nearby_stations) >= 1:
                    state["status"] = "LOCALIZED_ANOMALY"
                    if not spatially_consistent and agreement_index < 0.05:
                        state["sensors"]["temperature"]["wmo_flag"] = 2
                        state["sensors"]["temperature"]["status"] = "FLAG_ERRONEOUS"
                    else:
                        existing_flag = state["sensors"]["temperature"].get("wmo_flag", 0)
                        if existing_flag < 1:
                            state["sensors"]["temperature"]["wmo_flag"] = 1
                            state["sensors"]["temperature"]["status"] = "FLAG_SUSPECT"
                else:
                    state["status"] = "LOCALIZED_ANOMALY_UNCONFIRMED"

            spatial_result_str = "UNAVAILABLE"
            if len(nearby_stations) > 0:
                spatial_result_str = "CONSISTENT" if spatially_consistent else "CONTRADICTED"

            state["spatial_data"] = {
                "search_radius_km": 60.0,
                "nearby_stations": nearby_stations,
                "closest_peer": nearby_stations[0] if nearby_stations else None,
                "target_temperature": round(obs_temp, 1),
                "spatial_deviation": round(residual, 3),
                "spatial_result": spatial_result_str,
                "agreement_index": f"{int(spatial_analysis_dict.get('agreement_index', 0)*100)}%",
                "eligible_peer_count": len(nearby_stations),
                "fleet_station_count": len(new_state),
                "spatial_analysis": spatial_analysis_dict
            }

            classification = state["status"]
            ml_res = state.get("ml_model")

            # 3. Multi-Class Automated Root-Cause Diagnosis
            root_cause_diag = root_cause_classifier.diagnose(
                observation={"temp": obs_temp, "hum": obs_hum, "pres": obs_pres, "missing": is_missing},
                last_observation=previous_observation if previous_state else None,
                spatial_analysis=spatial_analysis_dict,
                thermo_violations=state.get("thermodynamic_violations"),
                battery_v=float(state["battery"]),
                signal_dbm=float(state["signal"]),
                ml_is_anomaly=bool(ml_res.get("is_anomaly", False)) if ml_res else False,
                ml_score=float(ml_res.get("anomaly_score", 0.0) or 0.0) if ml_res else 0.0,
                flatline_flag=state.get("is_flatline", False),
                temporal_evidence=temporal_evidence
            )
            if classification == "REGIONAL_EVENT":
                root_cause_diag = {
                    "root_cause": "REGIONAL_WEATHER_FRONT",
                    "confidence": 0.92,
                    "severity": "ALERT",
                    "category": "METEOROLOGICAL_EVENT",
                    "specific_reason": "Atmospheric anomaly corroborated by eligible fleet peers.",
                    "recommended_action": "Preserve the event and issue an operator meteorological alert.",
                }
            state["root_cause_diagnosis"] = root_cause_diag

            # 4. Self-Healing Real-Time Imputation
            anomalous_params = []
            if classification != "REGIONAL_EVENT":
                if classification in ["LOCALIZED_ANOMALY", "CRITICAL", "SUSPECT"] or state.get("sensors", {}).get("temperature", {}).get("wmo_flag", 0) > 0:
                    anomalous_params.append("temperature")
                if state.get("sensors", {}).get("humidity", {}).get("wmo_flag", 0) > 0:
                    anomalous_params.append("humidity")
                if state.get("sensors", {}).get("pressure", {}).get("wmo_flag", 0) > 0:
                    anomalous_params.append("pressure")

            from backend.app.storage.database import get_station_climatology
            climatology_results = get_station_climatology(st_id)

            imputed_data = imputation_engine.impute_observation(
                target_station=state,
                nearby_peers=nearby_stations,
                anomalous_params=anomalous_params,
                climatology_results=climatology_results
            )
            state["self_healing_data"] = imputed_data

            # 5. Sensor Health Index (SHI) & Predictive Maintenance
            health_record = sensor_health_engine.evaluate_station_health(
                station_id=st_id,
                current_status=classification,
                drift_rate_c_per_day=state.get("drift_rate", 0.0),
                battery_v=float(state["battery"]),
                signal_dbm=float(state["signal"]),
                flatline_detected=state.get("is_flatline", False),
                qc_envelope_breached=qc_envelope_breached
            )
            state["sensor_health"] = health_record

            # Calculate Evidence Fusion early to calibrate Confidence
            evidence_completeness = round(
                min(1.0, 0.5 + (0.25 if ml_res and ml_res.get("has_model") else 0.0) + (0.25 if len(nearby_stations) >= 2 else 0.0)),
                2
            )
            
            evidence_vector = {
                "z_qc": 1.0 if qc_envelope_breached else 0.0,
                "z_phys": 1.0 if state.get("thermodynamic_violations") else 0.0,
                "z_temp": 1.0 if temporal_evidence.get("spike") or temporal_evidence.get("noise") else 0.0,
                "z_ml": float(ml_res.get("anomaly_score") or 0.0) if ml_res else 0.0,
                "z_multi": 1.0 if not multivariate_evidence.get("valid") else 0.0,
                "z_health": round(max(0.0, 1.0 - (float(health_record.get("overall_health_score", 100.0)) / 100.0)), 3),
            }
            fusion_result = fuse_anomaly_evidence(evidence_vector)

            # Confidence logic based on multi-source evidence and fusion score
            confidence = "MEDIUM"
            if classification == "ANOMALY" and len(nearby_stations) == 0:
                confidence = "LOW"
            elif classification in ["CRITICAL", "LOCALIZED_ANOMALY", "REGIONAL_EVENT", "SPATIALLY_VALIDATED"]:
                if evidence_completeness >= 0.90 and fusion_result["score"] >= 0.75:
                    confidence = "HIGH"
                elif fusion_result["score"] < 0.50:
                    confidence = "LOW"
                else:
                    confidence = "MEDIUM"

            interpretation = root_cause_diag.get("specific_reason", "Nominal operations.")
            badge_class = "badge-normal"
            
            if classification == "REGIONAL_EVENT":
                badge_class = "badge-extreme"
            elif classification in ["LOCALIZED_ANOMALY", "CRITICAL"]:
                badge_class = "badge-critical"
            elif classification == "SUSPECT":
                badge_class = "badge-suspect"

            state["final_assessment"] = {
                "classification": classification,
                "root_cause": root_cause_diag.get("root_cause"),
                "confidence": confidence,
                "evidence_completeness": evidence_completeness,
                "fleet_evidence": spatial_analysis_dict,
                "readiness": readiness,
                "evidence_vector": evidence_vector,
                "interpretation": interpretation,
                "badge_class": badge_class,
                "xai_summary": ml_res.get("xai_explanation", {}).get("explanation_text") if ml_res and ml_res.get("xai_explanation") else None,
                "fusion": fusion_result
            }
            state["final_assessment"]["quality_state"] = "VALID" if classification == "NORMAL" else ("INVALID" if classification == "CRITICAL" else "SUSPECT")
            state["final_assessment"]["severity"] = (
                "CRITICAL" if classification == "CRITICAL" else
                "HIGH" if classification in ["LOCALIZED_ANOMALY", "REGIONAL_EVENT"] else
                "MEDIUM" if classification == "LOCALIZED_ANOMALY_UNCONFIRMED" else
                "NONE"
            )
            state["final_assessment"]["anomaly_score"] = ml_res.get("anomaly_score") if ml_res else None
            try:
                persist_assessment(
                    st_id,
                    state["final_assessment"],
                    source_timestamp=observation.get("timestamp") if isinstance(observation, dict) else None
                )
            except Exception as assessment_error:
                logger.warning(f"[ASSESSMENT PERSISTENCE] {st_id}: {assessment_error}")

            # -----------------------------------------------------------------
            # Automated Backend Incident Lifecycle Management
            # -----------------------------------------------------------------
            try:
                if classification in ["LOCALIZED_ANOMALY", "REGIONAL_EVENT", "ANOMALY", "CRITICAL", "SUSPECT"]:
                    reasons = [root_cause_diag.get("root_cause", "ANOMALY_DETECTED")]
                    if ml_res and ml_res.get("is_anomaly"):
                        score_val = ml_res.get("anomaly_score")
                        score_str = f"{round(float(score_val), 3)}" if score_val is not None else "DETECTED"
                        reasons.append(f"ML_SCORE_{score_str}")

                    closest_peer = nearby_stations[0] if nearby_stations else None
                    peer_st_id = closest_peer.get("station_id") if closest_peer else None
                    
                    qc_conf_local = all_qc_configs.get(st_id)
                    sensor_qc_ev = {
                        "station_normal_min": round(float(qc_conf_local.get("temperature_normal_min")), 2) if qc_conf_local and qc_conf_local.get("temperature_normal_min") is not None else None,
                        "station_normal_max": round(float(qc_conf_local.get("temperature_normal_max")), 2) if qc_conf_local and qc_conf_local.get("temperature_normal_max") is not None else None,
                        "unit": "°C",
                        "observed_value": round(obs_temp, 2),
                        "qc_result": "OUTSIDE_NORMAL_ENVELOPE" if qc_envelope_breached else "PASS",
                        "physical_qc": "FAIL" if state.get("thermodynamic_violations") else "PASS",
                        "fault_state": state.get("fault_details", {}).get("fault_type", "NONE_DETECTED") if state.get("fault_details") else "NONE_DETECTED"
                    }

                    inc_payload = {
                        "station_id": st_id,
                        "station_name": state["station_name"],
                        "variable": "air_temperature",
                        "severity": "critical" if classification in ["CRITICAL", "LOCALIZED_ANOMALY"] else "high",
                        "fault_risk": round(float(ml_res.get("anomaly_score", 0.85) or 0.85), 2),
                        "quality_state": classification,
                        "reason_codes": reasons,
                        "explanation": f"[{root_cause_diag.get('root_cause')}] {interpretation}",
                        "recommended_actions": [root_cause_diag.get("recommended_action", "Inspect station sensor terminal.")],
                        "evidence_ids": [f"EV-{st_id}-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')}"],
                        "evidence_data": {
                            "model_prediction": ml_res,
                            "root_cause_diagnosis": root_cause_diag,
                            "self_healing_data": imputed_data,
                            "sensor_health": health_record,
                            "spatial_evidence": state["spatial_data"],
                            "sensor_qc_evidence": sensor_qc_ev,
                            "final_assessment": state["final_assessment"]
                        }
                    }
                    create_or_update_incident(inc_payload)
                elif classification == "NORMAL":
                    resolve_open_incidents_for_station(st_id)
            except Exception as e:
                logger.error(f"[INCIDENT ERROR] {st_id}: {e}", exc_info=True)

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
