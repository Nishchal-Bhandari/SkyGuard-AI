import os
import re

file_path = r"backend\app\services\weather_service.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# I want to replace the second pass logic. Let's do it cleanly by splitting at specific markers.
# We will split at: "        # Second Pass: Spatial Consensus & Peer Adjudication"
# And end at: "        self.live_state = new_state"

start_marker = "        # Second Pass: Spatial Consensus & Peer Adjudication\n"
end_marker = "        self.live_state = new_state\n"

if start_marker not in content or end_marker not in content:
    print("Markers not found!")
    exit(1)

pre_content = content.split(start_marker)[0]
post_content = content.split(end_marker)[1]

new_logic = """        # Second Pass: Spatial Consensus, QC & Incident Adjudication
        from backend.app.storage.database import get_station_qc_config, create_or_update_incident, resolve_open_incidents_for_station

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

"""

with open(file_path, "w", encoding="utf-8") as f:
    f.write(pre_content + start_marker + new_logic + end_marker + post_content)
print("Updated weather_service.py successfully!")
