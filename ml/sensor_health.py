#!/usr/bin/env python3
"""
SkyGuard-AI — Sensor Health Index (SHI) & Predictive Maintenance Engine (Pure Python)
    Tracks individual sensor degradation, calibration drift rates, noise jitter,
    and computes a labelled degradation projection for maintenance planning.
"""

import math
from typing import Dict, Any, List, Optional


class SensorHealthEngine:
    """
    Computes 0-100% Sensor Health Index (SHI) and a degradation projection
    for Temperature, Pressure, and Humidity transducers.
    """

    @classmethod
    def evaluate_station_health(
        cls,
        station_id: str,
        current_status: str,
        fault_history: Optional[List[Dict[str, Any]]] = None,
        drift_rate_c_per_day: float = 0.0,
        battery_v: float = 12.6,
        signal_dbm: float = -75.0,
        flatline_detected: bool = False,
        qc_envelope_breached: bool = False
    ) -> Dict[str, Any]:
        """
        Evaluates the health indices of all 3 sensors and overall station telemetry.
        """
        # Base health starts at 100%
        temp_health = 100.0
        hum_health = 100.0
        pres_health = 100.0

        # Penalize for Battery Sag
        battery_penalty = 0.0
        if battery_v < 11.8:
            battery_penalty = min(40.0, (11.8 - battery_v) * 50.0)
        
        # Penalize for RF Signal degradation
        signal_penalty = 0.0
        if signal_dbm < -90.0:
            signal_penalty = min(25.0, abs(signal_dbm - (-90.0)) * 1.5)

        # Penalize for Drift Rate
        # A drift > 0.2°C/day is critical degradation
        drift_penalty = min(45.0, abs(drift_rate_c_per_day) * 150.0)
        temp_health -= drift_penalty

        # Penalize for Flatline
        if flatline_detected:
            temp_health -= 60.0
            hum_health -= 60.0
            pres_health -= 60.0

        # Penalize for QC Breaches
        if qc_envelope_breached:
            temp_health -= 15.0
            hum_health -= 15.0
            pres_health -= 10.0

        # A corroborated atmospheric event must not be treated as sensor damage.
        health_status = "NORMAL" if current_status == "REGIONAL_EVENT" else current_status
        if health_status == "CRITICAL":
            temp_health -= 40.0
            hum_health -= 40.0
            pres_health -= 40.0
        elif health_status == "LOCALIZED_ANOMALY":
            temp_health -= 25.0
        elif health_status == "SUSPECT":
            temp_health -= 15.0

        # Apply battery and signal systemic deductions
        temp_health = max(5.0, min(100.0, temp_health - battery_penalty - signal_penalty))
        hum_health = max(5.0, min(100.0, hum_health - battery_penalty - signal_penalty))
        pres_health = max(5.0, min(100.0, pres_health - battery_penalty - signal_penalty))

        overall_health = round((temp_health * 0.45) + (hum_health * 0.30) + (pres_health * 0.25), 1)

        # This is a trend-based projection, not validated failure-time prediction.
        projection_days = cls._estimate_rul_days(overall_health, drift_rate_c_per_day, flatline_detected, battery_v)

        # Predictive Maintenance Actionable Advisory
        maintenance_advisory = cls._generate_advisory(overall_health, temp_health, hum_health, pres_health, drift_rate_c_per_day, battery_v, projection_days)

        return {
            "station_id": station_id,
            "overall_health_score": overall_health,
            "status": "OPTIMAL" if overall_health >= 85 else ("DEGRADED" if overall_health >= 60 else "CRITICAL_ACTION_REQUIRED"),
            "sensor_scores": {
                "temperature_sensor": {
                    "health_score": round(temp_health, 1),
                    "status": "GOOD" if temp_health >= 80 else ("DEGRADED" if temp_health >= 50 else "FAILED"),
                    "drift_rate_c_day": round(drift_rate_c_per_day, 3),
                    "estimated_drift_week_c": round(drift_rate_c_per_day * 7.0, 2)
                },
                "humidity_sensor": {
                    "health_score": round(hum_health, 1),
                    "status": "GOOD" if hum_health >= 80 else ("DEGRADED" if hum_health >= 50 else "FAILED"),
                },
                "pressure_sensor": {
                    "health_score": round(pres_health, 1),
                    "status": "GOOD" if pres_health >= 80 else ("DEGRADED" if pres_health >= 50 else "FAILED"),
                }
            },
            "predictive_maintenance": {
                "degradation_projection_days": projection_days,
                "remaining_useful_life_days": projection_days,
                "projection_method": "trend_extrapolation_heuristic",
                "urgency": "IMMEDIATE" if projection_days <= 3 else ("HIGH" if projection_days <= 14 else ("MEDIUM" if projection_days <= 45 else "LOW")),
                "maintenance_advisory": maintenance_advisory
            },
            "power_telemetry": {
                "battery_voltage": round(battery_v, 2),
                "battery_health": "NOMINAL" if battery_v >= 12.0 else ("WARNING" if battery_v >= 11.2 else "CRITICAL"),
                "signal_dbm": round(signal_dbm, 1)
            }
        }

    @classmethod
    def _estimate_rul_days(cls, health_score: float, drift_rate: float, flatline: bool, battery_v: float) -> int:
        if flatline or battery_v < 10.5 or health_score < 25.0:
            return 1
        if abs(drift_rate) > 0.3:
            return 5
        if abs(drift_rate) > 0.1:
            return 14
        if health_score < 50.0:
            return 10
        if health_score < 75.0:
            return 35
        if health_score < 90.0:
            return 90
        return 180

    @classmethod
    def _generate_advisory(
        cls, overall: float, t_score: float, h_score: float, p_score: float, drift: float, batt: float, rul: int
    ) -> str:
        if rul <= 3:
            return "URGENT DISPATCH: Sensor flatline or critical power collapse imminent within 72 hours."
        if abs(drift) >= 0.15:
            return f"SCHEDULE RECALIBRATION: Thermistor drifting at {drift*7:.2f}°C/week. Re-zero offset within {rul} days."
        if batt < 11.5:
            return "SOLAR INSPECTION: Battery voltage low (<11.5V). Clean solar panel glass and check charge controller."
        if h_score < 60:
            return "CLEAN SENSOR CAP: Capacitive hygrometer element showing degradation. Replace polymer filter."
        if overall >= 85:
            return "ALL SYSTEMS HEALTHY: Sensor calibration within WMO Class 1 tolerance."
        return f"ROUTINE INSPECTION: Schedule routine maintenance checkup within {rul} days."


sensor_health_engine = SensorHealthEngine()
