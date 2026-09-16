#!/usr/bin/env python3
"""
SkyGuard-AI — Enhanced Engines Automated Verification Suite
Tests:
1. ThermodynamicEngine & Physics Bounds
2. TreeSHAP Explainability & Attributions
3. Multi-Class Root-Cause Classifier (7 classes)
4. Self-Healing Real-Time Imputation Engine (Spatial IDW + Lapse Rate)
5. Sensor Health Index (SHI) & RUL Calculation
6. End-to-end Station-Adaptive Pipeline with 3-param Thermodynamics
"""

import sys
import math
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.thermo_engine import thermo_engine
from ml.shap_engine import TreeSHAPEngine
from ml.root_cause_classifier import root_cause_classifier
from ml.imputation_engine import imputation_engine
from ml.sensor_health import sensor_health_engine
from ml.station_adaptive_pipeline import station_adaptive_pipeline


def test_thermodynamic_engine():
    print("\n--- TEST 1: Thermodynamic Physics Engine ---")
    t, p, rh, elev = 30.0, 1008.0, 70.0, 500.0
    
    es = thermo_engine.saturation_vapor_pressure(t)
    e = thermo_engine.actual_vapor_pressure(t, rh)
    td = thermo_engine.dew_point(t, rh)
    vpd = thermo_engine.vapor_pressure_deficit(t, rh)
    
    assert 42.0 <= es <= 43.0, f"Unexpected e_s: {es}"
    assert 29.0 <= e <= 31.0, f"Unexpected e: {e}"
    assert 23.5 <= td <= 24.5, f"Unexpected T_d: {td}"
    assert vpd > 0.0, "VPD should be positive"
    assert td <= t, "Dew point must not exceed air temperature"
    
    # Test Super-saturation rejection
    valid, violations = thermo_engine.validate_thermodynamic_bounds(t, p, 104.0, elev)
    assert not valid, "Super-saturation (RH=104%) must be flagged as invalid"
    assert any(v["type"] == "SUPER_SATURATION_VIOLATION" for v in violations)
    
    print("[PASS] Thermodynamic formulas & supersaturation checks passed successfully.")


def test_root_cause_classifier():
    print("\n--- TEST 2: Multi-Class Root-Cause Classifier ---")
    
    # Scenario A: Super-saturation violation
    obs_super = {"temp": 25.0, "hum": 104.0, "pres": 1010.0}
    _, violations = thermo_engine.validate_thermodynamic_bounds(25.0, 1010.0, 104.0, 0.0)
    res_a = root_cause_classifier.diagnose(obs_super, thermo_violations=violations)
    assert res_a["root_cause"] == "SUPER_SATURATION_VIOLATION", f"Expected SUPER_SATURATION_VIOLATION, got {res_a['root_cause']}"
    print(f"  [A] Super-saturation correctly diagnosed: {res_a['root_cause']} ({res_a['confidence']})")

    # Scenario B: Power Sag / Brownout
    obs_power = {"temp": 28.0, "hum": 65.0, "pres": 1010.0}
    res_b = root_cause_classifier.diagnose(obs_power, battery_v=10.9, ml_is_anomaly=True)
    assert res_b["root_cause"] == "POWER_SAG_BROWNOUT", f"Expected POWER_SAG_BROWNOUT, got {res_b['root_cause']}"
    print(f"  [B] Power sag correctly diagnosed: {res_b['root_cause']} ({res_b['confidence']})")

    # Scenario C: Thermal Spike (isolated sharp step change)
    obs_prev = {"temp": 25.0, "hum": 60.0, "pres": 1012.0}
    obs_spike = {"temp": 34.0, "hum": 60.0, "pres": 1012.0}
    spatial_dev = {"eligible_peer_count": 3, "spatially_consistent": False, "peer_anomaly_ratio": 0.0, "spatial_deviation_score": 8.5}
    res_c = root_cause_classifier.diagnose(obs_spike, last_observation=obs_prev, spatial_analysis=spatial_dev, ml_is_anomaly=True)
    assert res_c["root_cause"] == "THERMAL_SPIKE", f"Expected THERMAL_SPIKE, got {res_c['root_cause']}"
    print(f"  [C] Thermal spike correctly diagnosed: {res_c['root_cause']} ({res_c['confidence']})")

    # Scenario D: Regional Storm Front (Corroborated by spatial peers)
    spatial_front = {"eligible_peer_count": 4, "spatially_consistent": True, "peer_anomaly_ratio": 0.75, "spatial_deviation_score": 0.5}
    res_d = root_cause_classifier.diagnose(obs_spike, last_observation=obs_prev, spatial_analysis=spatial_front, ml_is_anomaly=True)
    assert res_d["root_cause"] == "REGIONAL_WEATHER_FRONT", f"Expected REGIONAL_WEATHER_FRONT, got {res_d['root_cause']}"
    print(f"  [D] Regional event correctly diagnosed: {res_d['root_cause']} ({res_d['confidence']})")

    # Scenario E: Sensor Flatline
    res_e = root_cause_classifier.diagnose(obs_prev, flatline_flag=True)
    assert res_e["root_cause"] == "SENSOR_FLATLINE", f"Expected SENSOR_FLATLINE, got {res_e['root_cause']}"
    print(f"  [E] Flatline correctly diagnosed: {res_e['root_cause']} ({res_e['confidence']})")

    print("[PASS] All Root-Cause Classification test cases passed.")


def test_imputation_engine():
    print("\n--- TEST 3: Self-Healing Real-Time Imputation Engine ---")
    
    # Target station at 600m elevation with a corrupted temperature reading (55°C)
    target = {
        "station_id": "AWS-07",
        "elevation": 600.0,
        "sensors": {
            "temperature": {"value": 55.0},
            "humidity": {"value": 80.0},
            "pressure": {"value": 950.0}
        }
    }
    
    # Nearby peers at sea level (0m) reporting 28°C and 29°C
    peers = [
        {"station_id": "AWS-01", "temp": 28.0, "hum": 75.0, "pres": 1012.0, "elevation": 0.0, "distance_km": 15.0, "status": "NORMAL"},
        {"station_id": "AWS-02", "temp": 29.0, "hum": 78.0, "pres": 1010.0, "elevation": 0.0, "distance_km": 25.0, "status": "NORMAL"},
    ]
    
    # Impute anomalous temperature
    healed = imputation_engine.impute_observation(target, peers, anomalous_params=["temperature"])
    assert healed["is_healed"] is True
    
    t_imputed = healed["imputed_sensors"]["temperature"]["value"]
    wmo_flag = healed["imputed_sensors"]["temperature"]["wmo_flag"]
    
    # At 600m elevation, temperature should be lower than sea level (~28.5°C - 0.0065*600 = ~24.6°C)
    assert 23.5 <= t_imputed <= 26.0, f"Expected lapse-rate adjusted temperature ~24.6°C, got {t_imputed}°C"
    assert wmo_flag == 3, f"Imputed value must have WMO Flag 3, got {wmo_flag}"
    print(f"[PASS] Self-Healing Imputation succeeded: Raw = 55.0 deg C -> Healed = {t_imputed} deg C (WMO Flag {wmo_flag}) via Lapse-Rate IDW.")


def test_sensor_health_engine():
    print("\n--- TEST 4: Sensor Health Index & Predictive Maintenance ---")
    
    # Healthy Station
    healthy_res = sensor_health_engine.evaluate_station_health("AWS-01", "NORMAL", battery_v=12.7, signal_dbm=-72.0)
    assert healthy_res["overall_health_score"] >= 95.0
    assert healthy_res["predictive_maintenance"]["remaining_useful_life_days"] >= 90
    print(f"  Healthy AWS SHI: {healthy_res['overall_health_score']}% (RUL: {healthy_res['predictive_maintenance']['remaining_useful_life_days']} days)")

    # Drifting Station (+0.25 °C/day)
    drifting_res = sensor_health_engine.evaluate_station_health("AWS-07", "LOCALIZED_ANOMALY", drift_rate_c_per_day=0.25, battery_v=12.1)
    assert drifting_res["overall_health_score"] < 75.0
    assert drifting_res["predictive_maintenance"]["remaining_useful_life_days"] <= 14
    print(f"  Drifting AWS SHI: {drifting_res['overall_health_score']}% (RUL: {drifting_res['predictive_maintenance']['remaining_useful_life_days']} days, Advisory: {drifting_res['predictive_maintenance']['maintenance_advisory'][:40]}...)")
    print("[PASS] Sensor Health Index & RUL estimation passed.")


def test_station_adaptive_pipeline_and_shap():
    print("\n--- TEST 5: Station-Adaptive ML Pipeline & TreeSHAP XAI ---")
    
    # Generate 50 realistic historical readings for station AWS-TEST
    history = []
    for h in range(50):
        hour = h % 24
        temp = 25.0 + 5.0 * math.sin(2 * math.pi * (hour - 6) / 24.0)
        hum = 60.0 - 15.0 * math.sin(2 * math.pi * (hour - 6) / 24.0)
        pres = 1012.0 + 2.0 * math.cos(2 * math.pi * hour / 12.0)
        history.append({"temp": temp, "hum": hum, "pres": pres, "hour": hour})

    model_card, _ = station_adaptive_pipeline.train_station_model("AWS-TEST", history, version="v1.0")
    print(f"  Trained model {model_card['model_id']} with dynamic threshold {model_card['training_summary']['dynamic_threshold']}")

    # Score a massive unphysical thermal spike
    anomaly_obs = {"temp": 52.0, "hum": 90.0, "pres": 1010.0, "hour": 14}
    res = station_adaptive_pipeline.score_realtime("AWS-TEST", anomaly_obs)
    
    assert res["is_anomaly"] is True, f"Expected anomaly, got score {res['anomaly_score']} with threshold {res['threshold']}"
    assert res["xai_explanation"] is not None, "TreeSHAP explanation must be present"
    
    xai = res["xai_explanation"]
    assert len(xai["attributions"]) == 8, f"Expected 8 feature attributions, got {len(xai['attributions'])}"
    print(f"  Anomaly detected (Score: {res['anomaly_score']}, Threshold: {res['threshold']})")
    print(f"  TreeSHAP Top Driver: {xai['primary_driver']}")
    print(f"  Natural Language Explanation: {xai['explanation_text']}")
    print("[PASS] Station-Adaptive Pipeline with TreeSHAP passed.")


if __name__ == "__main__":
    print("=================================================================")
    print(" SkyGuard-AI -- Enhanced Engines Automated Verification Suite ")
    print("=================================================================")
    test_thermodynamic_engine()
    test_root_cause_classifier()
    test_imputation_engine()
    test_sensor_health_engine()
    test_station_adaptive_pipeline_and_shap()
    print("\n=================================================================")
    print(" ALL VERIFICATION SUITES PASSED (100% SUCCESS) ")
    print("=================================================================\n")
    test_sensor_health_engine()
    test_station_adaptive_pipeline_and_shap()
    print("\n=================================================================")
    print(" ALL VERIFICATION SUITES PASSED (100% SUCCESS) ")
    print("=================================================================\n")
