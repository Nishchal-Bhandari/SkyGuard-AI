#!/usr/bin/env python3
"""
SkyGuard-AI — Multi-Class Automated Root-Cause Classifier (Pure Python)
Maps anomalous weather observations, spatial peer consensus, thermodynamic violations,
and hardware telemetry to concrete operational root causes with confidence scores.
"""

from typing import Dict, Any, List, Optional


class RootCauseClassifier:
    """
    Multi-Class Root-Cause Classifier for AWS Sensor Networks.
    Taxonomy:
    - THERMAL_SPIKE: Unphysical rapid step change in temperature.
    - SENSOR_FLATLINE: Zero variance / frozen sensor reading over time.
    - CALIBRATION_DRIFT: Progressive systemic offset divergence against spatial peers.
    - SUPER_SATURATION_VIOLATION: Breach of thermodynamic moisture saturation laws.
    - POWER_SAG_BROWNOUT: Sensor instability correlated with low battery voltage (<11.2V).
    - REGIONAL_WEATHER_FRONT: Severe weather confirmed across spatial neighborhood peers.
    - COMMUNICATION_CORRUPTION: Hardware framing error / stuck ADC code (-999, 65535, etc.).
    - NOMINAL: Normal operations within station microclimate envelopes.
    """

    ROOT_CAUSE_METADATA = {
        "THERMAL_SPIKE": {
            "severity": "HIGH",
            "category": "HARDWARE_TRANSIENT",
            "description": "Sudden unphysical step-change in sensor reading without meteorologic precursor.",
            "recommended_action": "Inspect sensor thermistor lead wires and shield for transient electrical surge."
        },
        "SENSOR_FLATLINE": {
            "severity": "CRITICAL",
            "category": "HARDWARE_FAILURE",
            "description": "Sensor output is frozen/stuck with zero variance over consecutive observation intervals.",
            "recommended_action": "Power-cycle data logger ADC channel; check for frozen sensor icing or bus lockup."
        },
        "CALIBRATION_DRIFT": {
            "severity": "MEDIUM",
            "category": "MAINTENANCE_REQUIRED",
            "description": "Continuous systematic bias divergence relative to surrounding spatial network.",
            "recommended_action": "Schedule recalibration or replace aging sensor element within 14 days."
        },
        "SUPER_SATURATION_VIOLATION": {
            "severity": "HIGH",
            "category": "PHYSICS_BREACH",
            "description": "Thermodynamic impossibility detected: Dew point exceeds ambient air temperature or RH > 100%.",
            "recommended_action": "Clean hygrometer capacitive polymer sensor and verify protective sinter filter."
        },
        "POWER_SAG_BROWNOUT": {
            "severity": "CRITICAL",
            "category": "INFRASTRUCTURE",
            "description": "Sensor telemetry corrupted by insufficient solar/battery bus supply voltage (<11.2V).",
            "recommended_action": "Inspect solar PV panel charge controller, battery terminals, and wiring."
        },
        "REGIONAL_WEATHER_FRONT": {
            "severity": "ALERT",
            "category": "METEOROLOGICAL_EVENT",
            "description": "True atmospheric storm or squall confirmed across multiple regional weather stations.",
            "recommended_action": "Issue automated meteorological alert; sensor is operating correctly."
        },
        "COMMUNICATION_CORRUPTION": {
            "severity": "CRITICAL",
            "category": "TELEMETRY_BUS",
            "description": "Corrupt telemetry code or missing packet payload received over communications link.",
            "recommended_action": "Check RS-485 / SDI-12 cabling and cellular modem signal integrity."
        },
        "MISSING_DATA": {
            "severity": "HIGH",
            "category": "DATA_AVAILABILITY",
            "description": "Expected observation is absent, stale, or incomplete.",
            "recommended_action": "Check station connectivity, buffer replay status, and logger timestamps."
        },
        "SENSOR_NOISE_DEGRADATION": {
            "severity": "MEDIUM",
            "category": "MAINTENANCE_REQUIRED",
            "description": "Excessive short-term variance indicates degrading sensor or acquisition noise.",
            "recommended_action": "Inspect shielding, grounding, connectors, and sensor element noise."
        },
        "NOMINAL": {
            "severity": "INFO",
            "category": "NORMAL_OPERATION",
            "description": "All atmospheric parameters and hardware health indicators operating within nominal limits.",
            "recommended_action": "No action required."
        }
    }
    
    @classmethod
    def diagnose(
        cls,
        observation: Dict[str, Any],
        last_observation: Optional[Dict[str, Any]] = None,
        spatial_analysis: Optional[Dict[str, Any]] = None,
        thermo_violations: Optional[List[Dict[str, Any]]] = None,
        battery_v: float = 12.6,
        signal_dbm: float = -75.0,
        ml_is_anomaly: bool = False,
        ml_score: float = 0.0,
        flatline_flag: bool = False,
        temporal_evidence: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes multi-class root-cause inference.
        Returns detailed classification, confidence, and recommended action.
        """
        temp = float(observation.get("temp", observation.get("temperature", 25.0)))
        hum = float(observation.get("hum", observation.get("humidity", 70.0)))
        pres = float(observation.get("pres", observation.get("pressure", 1013.25)))

        if observation.get("missing") or observation.get("stale"):
            return cls._build_result("MISSING_DATA", 0.95, "Observation is marked missing or stale by the ingestion freshness gate.")

        # 1. Check for Hardware Framing & Communication Corruption
        if temp < -70.0 or temp > 65.0 or pres < 500.0 or pres > 1100.0 or hum < 0.0 or hum > 105.0:
            alts = [{"root_cause": "SENSOR_FLATLINE", "confidence": 0.4}]
            return cls._build_result("COMMUNICATION_CORRUPTION", 0.99, "Sensor values breached impossible physical domain boundaries.", alts)

        # 2. Check for Power Sag / Brownout
        if battery_v < 11.2 or signal_dbm < -105.0:
            if ml_is_anomaly or (thermo_violations and len(thermo_violations) > 0):
                alts = [{"root_cause": "SENSOR_NOISE_DEGRADATION", "confidence": 0.6}]
                return cls._build_result("POWER_SAG_BROWNOUT", 0.95, f"Telemetry instability correlated with low battery ({battery_v:.2f}V) or weak signal ({signal_dbm:.1f}dBm).", alts)

        # 3. Check for Flatline / Frozen Values
        if flatline_flag:
            alts = [{"root_cause": "COMMUNICATION_CORRUPTION", "confidence": 0.5}]
            return cls._build_result("SENSOR_FLATLINE", 0.98, "Zero temporal variance detected across consecutive observations.", alts)

        if last_observation:
            prev_t = float(last_observation.get("temp", last_observation.get("temperature", temp)))
            prev_h = float(last_observation.get("hum", last_observation.get("humidity", hum)))
            prev_p = float(last_observation.get("pres", last_observation.get("pressure", pres)))
            # If all 3 values are exactly identical down to float precision over multiple reads
            if abs(temp - prev_t) < 0.0001 and abs(hum - prev_h) < 0.0001 and abs(pres - prev_p) < 0.0001 and flatline_flag:
                return cls._build_result("SENSOR_FLATLINE", 0.98, "Identical floating point telemetry across readings indicates ADC freeze.", [{"root_cause": "COMMUNICATION_CORRUPTION", "confidence": 0.5}])

        # 4. Check for Thermodynamic & Super-saturation Violations
        if thermo_violations and len(thermo_violations) > 0:
            primary_v = thermo_violations[0]
            v_type = primary_v.get("type", "")
            if v_type in ["SUPER_SATURATION_VIOLATION", "CLAUSIUS_CLAPEYRON_VIOLATION"]:
                alts = [{"root_cause": "CALIBRATION_DRIFT", "confidence": 0.6}, {"root_cause": "SENSOR_NOISE_DEGRADATION", "confidence": 0.3}]
                return cls._build_result("SUPER_SATURATION_VIOLATION", 0.96, primary_v.get("detail", "Thermodynamic saturation laws breached."), alts)

        # 5. Check for Noise Degradation (new class)
        if temporal_evidence and temporal_evidence.get("noise"):
            alts = [{"root_cause": "CALIBRATION_DRIFT", "confidence": 0.5}]
            return cls._build_result("SENSOR_NOISE_DEGRADATION", 0.88, "High-frequency variance detected indicative of degraded shielding or ADC noise.", alts)

        # 6. Check for Regional Weather Front vs Localized Anomaly
        if spatial_analysis:
            peer_count = spatial_analysis.get("eligible_peer_count", 0)
            spatially_consistent = spatial_analysis.get("spatially_consistent")
            peer_anomaly_ratio = spatial_analysis.get("peer_anomaly_ratio", 0.0)
            spatial_dev = spatial_analysis.get("spatial_deviation_score", 0.0)

            if ml_is_anomaly or spatial_dev > 4.0:
                # If peers also see the event OR target reading matches peer median
                if (peer_count >= 2 and (spatially_consistent or peer_anomaly_ratio >= 0.40)):
                    alts = [{"root_cause": "NOMINAL", "confidence": 0.4}]
                    return cls._build_result(
                        "REGIONAL_WEATHER_FRONT",
                        0.92,
                        f"Atmospheric anomaly corroborated by {peer_count} spatial peers (peer anomaly ratio: {peer_anomaly_ratio * 100:.0f}%).",
                        alts
                    )
                # If peers disagree strongly
                if peer_count >= 1 and spatially_consistent is False:
                    # Check if it's an instantaneous spike vs a gradual drift
                    if last_observation:
                        prev_t = float(last_observation.get("temp", last_observation.get("temperature", temp)))
                        delta_t = abs(temp - prev_t)
                        if delta_t >= 4.0:
                            alts = [{"root_cause": "CALIBRATION_DRIFT", "confidence": 0.4}, {"root_cause": "SENSOR_NOISE_DEGRADATION", "confidence": 0.3}]
                            return cls._build_result("THERMAL_SPIKE", 0.94, f"Rapid unphysical jump of {delta_t:.1f}°C in single time step while peers remain steady.", alts)
                    
                    alts = [{"root_cause": "SENSOR_NOISE_DEGRADATION", "confidence": 0.5}, {"root_cause": "THERMAL_SPIKE", "confidence": 0.2}]
                    return cls._build_result("CALIBRATION_DRIFT", 0.88, f"Systematic deviation ({spatial_dev:.1f}°C) from surrounding peer median.", alts)

        # 7. Check single-station temporal spikes without peers
        if last_observation:
            prev_t = float(last_observation.get("temp", last_observation.get("temperature", temp)))
            if abs(temp - prev_t) >= 6.0:
                alts = [{"root_cause": "CALIBRATION_DRIFT", "confidence": 0.4}]
                return cls._build_result("THERMAL_SPIKE", 0.90, f"Sudden delta of {abs(temp - prev_t):.1f}°C exceeds atmospheric maximum rate of change.", alts)

        if ml_is_anomaly:
            alts = [{"root_cause": "SENSOR_NOISE_DEGRADATION", "confidence": 0.5}]
            return cls._build_result("CALIBRATION_DRIFT", round(min(0.95, ml_score), 2), f"Statistical isolation anomaly detected by microclimate model (score: {ml_score:.3f}).", alts)

        return cls._build_result("NOMINAL", 0.99, "Nominal meteorological and sensor health status.")

    @classmethod
    def _build_result(cls, root_cause_key: str, confidence: float, specific_reason: str, alternatives: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        meta = cls.ROOT_CAUSE_METADATA.get(root_cause_key, cls.ROOT_CAUSE_METADATA["NOMINAL"])
        return {
            "root_cause": root_cause_key,
            "confidence": round(confidence, 2),
            "severity": meta["severity"],
            "category": meta["category"],
            "description": meta["description"],
            "specific_reason": specific_reason,
            "recommended_action": meta["recommended_action"],
            "ranked_alternatives": alternatives or []
        }

root_cause_classifier = RootCauseClassifier()
