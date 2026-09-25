#!/usr/bin/env python3
"""
SkyGuard-AI — Self-Healing Real-Time Data Imputation Engine (Pure Python)
Reconstructs corrupted or missing AWS sensor observations using:
1. Spatial Inverse Distance Weighting (IDW) with Tropospheric Lapse-Rate Elevation Correction.
2. Hypsometric barometric compensation.
3. Psychrometric / Thermodynamic equilibrium fallback for isolated stations.
Flags imputed parameters with WMO Standard Flag 3 (Corrected/Imputed).
"""

import math
from typing import Dict, Any, List, Optional, Tuple
from ml.thermo_engine import thermo_engine


class ImputationEngine:
    """
    Self-Healing Data Imputation Engine.
    Converts corrupt sensor streams into clean, reliable data for downstream consumers.
    """

    LAPSE_RATE_C_PER_M = 0.0065  # 6.5 °C / 1000m

    @classmethod
    def impute_observation(
        cls,
        target_station: Dict[str, Any],
        nearby_peers: List[Dict[str, Any]],
        anomalous_params: Optional[List[str]] = None,
        station_history: Optional[List[Dict[str, Any]]] = None,
        climatology_results: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes real-time imputation for flagged anomalous parameters.
        Returns the self-healed observation record with WMO flags and imputation metadata.
        """
        if anomalous_params is None:
            anomalous_params = []

        target_elev = float(target_station.get("elevation", target_station.get("elevation_m", 0.0)) or 0.0)
        raw_sensors = target_station.get("sensors", {})
        
        # Extract raw values
        raw_t = float(raw_sensors.get("temperature", {}).get("value", target_station.get("temp", 25.0)))
        raw_h = float(raw_sensors.get("humidity", {}).get("value", target_station.get("hum", 65.0)))
        raw_p = float(raw_sensors.get("pressure", {}).get("value", target_station.get("pres", 1013.25)))
        
        ts = str(target_station.get("timestamp", ""))
        try:
            import datetime
            dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            day_of_year = dt.timetuple().tm_yday
            hour = dt.hour
        except Exception:
            day_of_year = 1
            hour = 12

        imputed_record = {
            "temperature": {"value": raw_t, "unit": "°C", "wmo_flag": 0, "is_imputed": False},
            "humidity": {"value": raw_h, "unit": "%", "wmo_flag": 0, "is_imputed": False},
            "pressure": {"value": raw_p, "unit": "hPa", "wmo_flag": 0, "is_imputed": False},
        }

        # Filter valid healthy peers for spatial interpolation
        healthy_peers = [
            p for p in nearby_peers
            if p.get("status") in ["NORMAL", "NOMINAL", "LOCAL_ML_ONLY"]
            and p.get("distance_km", 999) > 0.1
        ]

        # 1. Impute Temperature if anomalous
        if "temperature" in anomalous_params or "temp" in anomalous_params:
            imputed_t, method = cls._impute_temperature(raw_t, target_elev, healthy_peers, station_history, climatology_results, hour, day_of_year)
            imputed_record["temperature"] = {
                "value": round(imputed_t, 1),
                "raw_value": round(raw_t, 1),
                "unit": "°C",
                "wmo_flag": 3,
                "is_imputed": True,
                "method": method
            }

        # 2. Impute Humidity if anomalous
        if "humidity" in anomalous_params or "hum" in anomalous_params:
            current_t = float(str(imputed_record["temperature"]["value"]))
            imputed_h, method = cls._impute_humidity(raw_h, current_t, healthy_peers, station_history, climatology_results, hour, day_of_year)
            imputed_record["humidity"] = {
                "value": round(imputed_h, 1),
                "raw_value": round(raw_h, 1),
                "unit": "%",
                "wmo_flag": 3,
                "is_imputed": True,
                "method": method
            }

        # 3. Impute Pressure if anomalous
        if "pressure" in anomalous_params or "pres" in anomalous_params:
            imputed_p, method = cls._impute_pressure(raw_p, target_elev, healthy_peers, station_history, climatology_results, hour, day_of_year)
            imputed_record["pressure"] = {
                "value": round(imputed_p, 1),
                "raw_value": round(raw_p, 1),
                "unit": "hPa",
                "wmo_flag": 3,
                "is_imputed": True,
                "method": method
            }

        # Ensure post-imputation thermodynamic consistency
        final_t = float(str(imputed_record["temperature"]["value"]))
        final_h = float(str(imputed_record["humidity"]["value"]))
        final_p = float(str(imputed_record["pressure"]["value"]))
        
        # Verify no supersaturation in imputed stream
        if final_h > 100.0:
            imputed_record["humidity"]["value"] = 100.0
            imputed_record["humidity"]["is_imputed"] = True
            imputed_record["humidity"]["wmo_flag"] = 3
            final_h = 100.0

        thermo_stats = thermo_engine.compute_all_thermodynamic_features(final_t, final_p, final_h, target_elev)

        return {
            "station_id": target_station.get("station_id", "UNKNOWN"),
            "is_healed": len(anomalous_params) > 0,
            "healed_parameters_count": len(anomalous_params),
            "imputed_sensors": imputed_record,
            "derived_thermodynamics": thermo_stats
        }

    @classmethod
    def _impute_temperature(
        cls, raw_t: float, target_elev: float, peers: List[Dict[str, Any]], history: Optional[List[Dict[str, Any]]],
        climatology: Optional[Dict[str, Any]], hour: float, day_of_year: float
    ) -> Tuple[float, str]:
        if peers:
            # Spatial IDW with Lapse Rate Correction
            weights = []
            adj_temps = []
            for p in peers:
                d = max(1.0, float(p.get("distance_km", 10.0)))
                w = 1.0 / (d ** 2)
                p_temp = float(p.get("temp", p.get("temperature", 25.0)))
                p_elev = float(p.get("elevation", 0.0) or 0.0)
                
                # Adjust peer temp to target elevation using standard lapse rate
                # Higher elevation -> Cooler temperature
                elev_delta = target_elev - p_elev
                adj_t = p_temp - (cls.LAPSE_RATE_C_PER_M * elev_delta)
                
                weights.append(w)
                adj_temps.append(adj_t * w)

            sum_w = sum(weights)
            if sum_w > 0:
                return (sum(adj_temps) / sum_w), "SPATIAL_IDW_LAPSE_RATE"

        if climatology and "temperature" in climatology:
            from ml.climatology_engine import climatology_engine
            c = climatology["temperature"]
            exp = climatology_engine.compute_expected(c["coefficients"], hour, day_of_year)
            # We can optionally add temporal lag (last known residual), but for simplicity use climatology expected
            return exp, "CLIMATOLOGY_EXPECTED"

        # Fallback to local station temporal rolling average
        if history and len(history) > 0:
            recent_temps = [float(h.get("temp", h.get("temperature", raw_t))) for h in history[-5:] if abs(float(h.get("temp", h.get("temperature", raw_t))) - raw_t) < 15.0]
            if recent_temps:
                return (sum(recent_temps) / len(recent_temps)), "TEMPORAL_ROLLING_MEAN"

        # Fallback to standard atmospheric nominal
        t_standard = 15.0 - (cls.LAPSE_RATE_C_PER_M * target_elev)
        return t_standard, "STANDARD_ATMOSPHERE_FALLBACK"

    @classmethod
    def _impute_humidity(
        cls, raw_h: float, target_t: float, peers: List[Dict[str, Any]], history: Optional[List[Dict[str, Any]]],
        climatology: Optional[Dict[str, Any]], hour: float, day_of_year: float
    ) -> Tuple[float, str]:
        if peers:
            weights = []
            hums = []
            for p in peers:
                d = max(1.0, float(p.get("distance_km", 10.0)))
                w = 1.0 / (d ** 2)
                p_hum = float(p.get("hum", p.get("humidity", 65.0)))
                weights.append(w)
                hums.append(p_hum * w)

            sum_w = sum(weights)
            if sum_w > 0:
                return max(10.0, min(100.0, sum(hums) / sum_w)), "SPATIAL_IDW"

        if climatology and "humidity" in climatology:
            from ml.climatology_engine import climatology_engine
            c = climatology["humidity"]
            exp = climatology_engine.compute_expected(c["coefficients"], hour, day_of_year)
            return max(10.0, min(100.0, exp)), "CLIMATOLOGY_EXPECTED"

        if history and len(history) > 0:
            recent_h = [float(h.get("hum", h.get("humidity", 65.0))) for h in history[-5:]]
            if recent_h:
                return max(10.0, min(100.0, sum(recent_h) / len(recent_h))), "TEMPORAL_ROLLING_MEAN"

        return 65.0, "CLIMATOLOGICAL_NOMINAL"

    @classmethod
    def _impute_pressure(
        cls, raw_p: float, target_elev: float, peers: List[Dict[str, Any]], history: Optional[List[Dict[str, Any]]],
        climatology: Optional[Dict[str, Any]], hour: float, day_of_year: float
    ) -> Tuple[float, str]:
        if peers:
            weights = []
            pressures = []
            for p in peers:
                d = max(1.0, float(p.get("distance_km", 10.0)))
                w = 1.0 / (d ** 2)
                p_pres = float(p.get("pres", p.get("pressure", 1013.25)))
                p_elev = float(p.get("elevation", 0.0) or 0.0)
                
                # Hypsometric ratio adjustment
                elev_delta = target_elev - p_elev
                adj_p = p_pres * math.exp(-elev_delta / 8430.0)  # Scale height ~8.43 km
                weights.append(w)
                pressures.append(adj_p * w)

            sum_w = sum(weights)
            if sum_w > 0:
                return (sum(pressures) / sum_w), "SPATIAL_HYPSOMETRIC_IDW"

        if climatology and "pressure" in climatology:
            from ml.climatology_engine import climatology_engine
            c = climatology["pressure"]
            exp = climatology_engine.compute_expected(c["coefficients"], hour, day_of_year)
            return exp, "CLIMATOLOGY_EXPECTED"

        # Theoretical barometric formula based on altitude
        p_hyp = thermo_engine.expected_hypsometric_pressure(target_elev)
        return p_hyp, "HYPSOMETRIC_BAROMETRIC_FORMULA"


imputation_engine = ImputationEngine()
