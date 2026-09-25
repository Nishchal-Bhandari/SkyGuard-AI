#!/usr/bin/env python3
"""
SkyGuard-AI — Feature Engine (v2)
Builds the 8-D residual-first feature space.
"""

import math
from typing import Dict, Any, List, Tuple
from ml.thermo_engine import thermo_engine

class FeatureEngine:
    def __init__(self):
        self.feature_names = [
            "z_T",          # climatology-normalised residual z-scores
            "z_H",
            "z_P",
            "z_dpd",        # dew-point depression z-score
            "p_elev_resid", # pressure elevation residual
            "var3",         # 3-observation rolling variance
            "persist",      # consecutive-anomaly count
            "z_T_lag1",     # lagged temperature residual
            "hour_phase"    # sin(2πh/24) cyclic phase
        ]

    def _extract_val(self, obs: Dict[str, Any], keys: List[str], default: float) -> float:
        for k in keys:
            if k in obs and obs[k] is not None and obs[k] != "":
                try:
                    return float(obs[k])
                except (ValueError, TypeError):
                    pass
        return default

    def engineer_features_v2(self, valid_rows: List[Dict[str, Any]], climatology_results: Dict[str, Any], target_elev: float = 0.0) -> Tuple[List[List[float]], Dict[str, Any]]:
        """
        Engineers v2 feature vectors for a historical dataset using the fitted climatology.
        Returns the feature matrix X and normalization stats.
        """
        if not valid_rows:
            return [], {}

        X = []
        n = len(valid_rows)
        
        # We need stats for standardizing the derived features (z_dpd, p_elev_resid, var3, z_T_lag1)
        z_dpds = []
        p_elev_resids = []
        
        # Precompute expected values for each observation
        from ml.climatology_engine import climatology_engine
        
        # Prepare arrays for rolling stats
        z_T_series = []
        z_H_series = []
        z_P_series = []
        
        for obs in valid_rows:
            import datetime
            ts = str(obs.get("timestamp", ""))
            try:
                dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                day_of_year = dt.timetuple().tm_yday
            except Exception:
                day_of_year = 1
            hour = float(obs.get("hour", 12))
            
            temp = self._extract_val(obs, ["temp", "temperature", "temperature_c"], 25.0)
            hum = self._extract_val(obs, ["hum", "humidity", "humidity_pct"], 60.0)
            pres = self._extract_val(obs, ["pres", "pressure", "pressure_hpa"], 1010.0)
            
            # Compute z_T, z_H, z_P
            def get_z(param, val, day_of_year, hour):
                if param in climatology_results:
                    c = climatology_results[param]
                    exp = climatology_engine.compute_expected(c["coefficients"], hour, day_of_year)
                    return (val - exp) / max(c["robust_sigma"], 1e-6)
                return 0.0
                
            z_T = get_z("temperature", temp, day_of_year, hour)
            z_H = get_z("humidity", hum, day_of_year, hour)
            z_P = get_z("pressure", pres, day_of_year, hour)
            
            z_T_series.append(z_T)
            z_H_series.append(z_H)
            z_P_series.append(z_P)
            
            # dpd
            dpd = max(0.0, temp - thermo_engine.dew_point(temp, hum))
            z_dpds.append(dpd)
            
            # p_elev_resid
            expected_p = thermo_engine.expected_hypsometric_pressure(target_elev)
            p_elev_resids.append(pres - expected_p)

        # Standardize dpd and p_elev_resid
        def calc_stats(arr):
            mean = sum(arr) / len(arr) if arr else 0.0
            std = math.sqrt(sum((x - mean)**2 for x in arr) / len(arr)) if arr else 1.0
            return mean, max(std, 1e-6)
            
        dpd_mean, dpd_std = calc_stats(z_dpds)
        p_elev_mean, p_elev_std = calc_stats(p_elev_resids)
        
        stats = {
            "dpd_mean": dpd_mean, "dpd_std": dpd_std,
            "p_elev_mean": p_elev_mean, "p_elev_std": p_elev_std,
            "feature_space_version": 2
        }

        # Build feature vectors
        persist_count = 0
        for i in range(n):
            hour = float(valid_rows[i].get("hour", 12))
            hour_phase = math.sin(2 * math.pi * hour / 24.0)
            
            z_T = z_T_series[i]
            z_H = z_H_series[i]
            z_P = z_P_series[i]
            
            # var3: 3-observation rolling variance of z_T
            if i >= 2:
                window = z_T_series[i-2:i+1]
                mean_w = sum(window)/3
                var3 = sum((x - mean_w)**2 for x in window)/3
            else:
                var3 = 0.0
                
            # persist: consecutive anomalies (rough heuristic here: |z_T| > 2)
            if abs(z_T) > 2.0:
                persist_count += 1
            else:
                persist_count = 0
                
            z_T_lag1 = z_T_series[i-1] if i > 0 else z_T
            
            z_dpd = (z_dpds[i] - dpd_mean) / dpd_std
            p_elev_resid = (p_elev_resids[i] - p_elev_mean) / p_elev_std
            
            # Keep it strictly to the 8 required features for IF backward compat if wanted, 
            # or use the full 9 v2 features. Actually, v2 specifies 12 features, but 
            # the design doc lists 8 in the feature_names above. Let's use 8 for now.
            x_vec = [
                round(z_T, 3),
                round(z_H, 3),
                round(z_P, 3),
                round(z_dpd, 3),
                round(p_elev_resid, 3),
                round(var3, 3),
                round(z_T_lag1, 3),
                round(hour_phase, 3)
            ]
            X.append(x_vec)
            
        return X, stats
        
feature_engine = FeatureEngine()
