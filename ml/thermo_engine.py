#!/usr/bin/env python3
"""
SkyGuard-AI — Thermodynamic Law & Physics Validator (Pure Python)
Implements meteorological thermodynamic equations for 3 parameters:
- Temperature (T, °C)
- Atmospheric Pressure (P, hPa)
- Relative Humidity (RH, %)
- Elevation (z, m)
"""

import math
from typing import Dict, Any, Tuple, Optional


class ThermodynamicEngine:
    """
    Thermodynamic and atmospheric physics validator.
    Strictly follows WMO-No. 8 and standard atmospheric physics.
    """

    # Physical Constants
    R_SPECIFIC_DRY_AIR = 287.058  # J / (kg * K)
    LAPSE_RATE_STANDARD = 0.0065  # K/m (6.5 °C per 1000m)
    SEA_LEVEL_PRESSURE = 1013.25  # hPa
    SEA_LEVEL_TEMP_K = 288.15     # 15 °C in Kelvin
    GRAVITY = 9.80665             # m/s^2

    @staticmethod
    def saturation_vapor_pressure(temp_c: float) -> float:
        """
        Computes Saturation Vapor Pressure e_s (hPa) using the Magnus-Tetens formula.
        Valid for -45°C <= T <= 60°C.
        """
        a = 17.67
        b = 243.5
        es = 6.112 * math.exp((a * temp_c) / (temp_c + b))
        return es

    @staticmethod
    def actual_vapor_pressure(temp_c: float, rh_pct: float) -> float:
        """
        Computes Actual Vapor Pressure e (hPa) from T and RH.
        e = (RH / 100.0) * e_s(T)
        """
        rh_clamped = max(0.0, min(100.0, rh_pct))
        es = ThermodynamicEngine.saturation_vapor_pressure(temp_c)
        return (rh_clamped / 100.0) * es

    @staticmethod
    def dew_point(temp_c: float, rh_pct: float) -> float:
        """
        Computes Exact Dew Point Temperature T_d (°C) using the Magnus-Tetens inverse.
        """
        rh_clamped = max(0.001, min(100.0, rh_pct))
        a = 17.67
        b = 243.5
        gamma = (a * temp_c / (b + temp_c)) + math.log(rh_clamped / 100.0)
        td = (b * gamma) / (a - gamma)
        return td

    @staticmethod
    def vapor_pressure_deficit(temp_c: float, rh_pct: float) -> float:
        """
        Computes Vapor Pressure Deficit (VPD in hPa).
        VPD = e_s(T) - e(T, RH)
        """
        es = ThermodynamicEngine.saturation_vapor_pressure(temp_c)
        e = ThermodynamicEngine.actual_vapor_pressure(temp_c, rh_pct)
        return max(0.0, es - e)

    @staticmethod
    def moist_air_density(temp_c: float, pres_hpa: float, rh_pct: float) -> float:
        """
        Computes Moist Air Density rho (kg/m^3) using ideal gas law with water vapor virtual temperature correction.
        """
        temp_k = temp_c + 273.15
        p_pa = pres_hpa * 100.0  # hPa to Pa
        e_pa = ThermodynamicEngine.actual_vapor_pressure(temp_c, rh_pct) * 100.0
        p_dry = p_pa - e_pa

        r_dry = 287.058
        r_vapor = 461.495

        rho_dry = p_dry / (r_dry * temp_k)
        rho_vapor = e_pa / (r_vapor * temp_k)
        return rho_dry + rho_vapor

    @staticmethod
    def expected_hypsometric_pressure(elevation_m: float) -> float:
        """
        Computes Expected Barometric Pressure (hPa) at a given elevation (m) under standard atmosphere.
        P(z) = P0 * (1 - (L * z) / T0) ^ (g / (R * L))
        """
        z = max(0.0, elevation_m)
        exponent = (ThermodynamicEngine.GRAVITY / (ThermodynamicEngine.R_SPECIFIC_DRY_AIR * ThermodynamicEngine.LAPSE_RATE_STANDARD))
        p_exp = ThermodynamicEngine.SEA_LEVEL_PRESSURE * math.pow(
            1.0 - (ThermodynamicEngine.LAPSE_RATE_STANDARD * z) / ThermodynamicEngine.SEA_LEVEL_TEMP_K,
            exponent
        )
        return p_exp

    @classmethod
    def compute_all_thermodynamic_features(
        cls, temp_c: float, pres_hpa: float, rh_pct: float, elevation_m: float = 0.0
    ) -> Dict[str, float]:
        """
        Derives all high-order thermodynamic features from the 3 fundamental parameters.
        """
        es = cls.saturation_vapor_pressure(temp_c)
        e = cls.actual_vapor_pressure(temp_c, rh_pct)
        td = cls.dew_point(temp_c, rh_pct)
        dew_depr = max(0.0, temp_c - td)
        vpd = cls.vapor_pressure_deficit(temp_c, rh_pct)
        density = cls.moist_air_density(temp_c, pres_hpa, rh_pct)
        p_expected = cls.expected_hypsometric_pressure(elevation_m)
        p_anomaly_delta = pres_hpa - p_expected

        return {
            "sat_vapor_pressure_hpa": round(es, 3),
            "act_vapor_pressure_hpa": round(e, 3),
            "dew_point_c": round(td, 2),
            "dew_point_depression_c": round(dew_depr, 2),
            "vapor_pressure_deficit_hpa": round(vpd, 3),
            "air_density_kg_m3": round(density, 4),
            "expected_hypsometric_pres_hpa": round(p_expected, 2),
            "hypsometric_pres_delta_hpa": round(p_anomaly_delta, 2),
        }

    @classmethod
    def validate_thermodynamic_bounds(
        cls, temp_c: float, pres_hpa: float, rh_pct: float, elevation_m: float = 0.0
    ) -> Tuple[bool, list]:
        """
        Strict thermodynamic law verification.
        Returns (is_valid, list_of_violations).
        """
        violations = []

        # 1. Physical WMO Extreme Limits
        if temp_c < -80.0 or temp_c > 65.0:
            violations.append({
                "type": "PHYSICAL_LIMIT_BREACH",
                "param": "temperature",
                "detail": f"Temperature {temp_c}°C exceeds Earth operational bounds [-80, +65]°C"
            })
        if pres_hpa < 500.0 or pres_hpa > 1100.0:
            violations.append({
                "type": "PHYSICAL_LIMIT_BREACH",
                "param": "pressure",
                "detail": f"Pressure {pres_hpa} hPa exceeds operational bounds [500, 1100] hPa"
            })
        if rh_pct < 0.0 or rh_pct > 105.0:
            violations.append({
                "type": "PHYSICAL_LIMIT_BREACH",
                "param": "humidity",
                "detail": f"Relative Humidity {rh_pct}% exceeds bounds [0, 100]%"
            })

        # 2. Super-saturation Check (RH > 100.5%)
        if rh_pct > 100.5:
            violations.append({
                "type": "SUPER_SATURATION_VIOLATION",
                "param": "humidity",
                "detail": f"Super-saturation detected: RH = {rh_pct}% (Max permissible = 100.0%)"
            })

        # 3. Clausius-Clapeyron Dew Point Law: T >= T_d
        td = cls.dew_point(temp_c, min(100.0, max(0.01, rh_pct)))
        if td > (temp_c + 0.25):
            violations.append({
                "type": "CLAUSIUS_CLAPEYRON_VIOLATION",
                "param": "dew_point",
                "detail": f"Dew point ({td:.2f}°C) exceeds ambient air temperature ({temp_c:.2f}°C)"
            })

        # 4. Hypsometric Elevation Pressure Sanity Check
        p_expected = cls.expected_hypsometric_pressure(elevation_m)
        p_delta = abs(pres_hpa - p_expected)
        if p_delta > 90.0:
            violations.append({
                "type": "HYPSOMETRIC_DISCORDANCE",
                "param": "pressure",
                "detail": f"Pressure {pres_hpa} hPa deviates by {p_delta:.1f} hPa from expected altitude pressure ({p_expected:.1f} hPa)"
            })

        return (len(violations) == 0), violations


thermo_engine = ThermodynamicEngine()
