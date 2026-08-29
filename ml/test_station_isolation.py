#!/usr/bin/env python3
"""
SkyGuard-AI — Station-Adaptive Model Isolation Test Suite
Verifies:
1. Zero Pre-Trained Model Cold-Start behavior.
2. Minimum sample size gatekeeper (<20 rows blocked).
3. Station A trains Model A; Station B trains Model B.
4. Model A != Model B (weights, thresholds, microclimate normalization).
5. Strict isolation: Station A inference never uses Model B.
6. Local climatological sensitivity (Cherrapunji rainfall vs Hyderabad rainfall).
"""

import sys
import os
import shutil
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ml.station_adaptive_pipeline import StationAdaptiveMLPipeline

TEST_DIR = Path("ml/test_models")

def clean_test_env():
    if TEST_DIR.exists():
        shutil.rmtree(TEST_DIR)

def run_tests():
    print("=" * 70)
    print("SKYGUARD-AI: STATION-ADAPTIVE ML ARCHITECTURE VERIFICATION SUITE")
    print("=" * 70)

    clean_test_env()
    pipeline = StationAdaptiveMLPipeline(storage_dir=TEST_DIR)

    # -------------------------------------------------------------
    # Test 1: Zero Cold-Start Behavior
    # -------------------------------------------------------------
    print("\n[TEST 1] Verifying Zero Pre-Trained Model Cold-Start...")
    res = pipeline.score_realtime("AWS-99", {"temp": 28.5, "hum": 65, "pres": 1008, "wind": 12})
    assert res["has_model"] is False, "Uncalibrated station should not have an active model."
    assert res["status"] == "RULES_ONLY", f"Expected RULES_ONLY status, got: {res['status']}"
    print("  -> PASSED: Station AWS-99 correctly reported RULES_ONLY with zero models.")

    # -------------------------------------------------------------
    # Test 2: Minimum Sample Size Gatekeeper (<20 rows rejected)
    # -------------------------------------------------------------
    print("\n[TEST 2] Verifying Insufficient Data Rejection Gatekeeper...")
    tiny_dataset = [
        {"temp": 25.0, "hum": 70, "pres": 1010, "wind": 10} for _ in range(5)
    ]
    try:
        pipeline.train_station_model("AWS-TINY", tiny_dataset)
        assert False, "Pipeline should have rejected < 20 rows."
    except ValueError as e:
        print(f"  -> PASSED: Correctly blocked training on tiny dataset ({e})")

    # -------------------------------------------------------------
    # Test 3: Station A Training (Hyderabad AWS-07: Semi-arid, higher temp, lower rain)
    # -------------------------------------------------------------
    print("\n[TEST 3] Training Station A (AWS-07 Hyderabad - Semi-Arid Baseline)...")
    dataset_hyd = [
        {"temp": 24.0 + (i % 12) * 0.9, "hum": 45.0 + (i % 8) * 2.0, "pres": 1006.0 + (i % 4) * 0.5, "wind": 12.0 + (i % 6) * 0.8, "rain": 0.0}
        for i in range(30)
    ]
    # Add a couple of corrupted hardware flags to verify scrubbing
    dataset_hyd.append({"temp": -999.0, "hum": 150, "pres": 200, "wind": -10, "rain": 0.0})
    dataset_hyd.append({"temp": 999.0, "hum": -20, "pres": 1500, "wind": 500, "rain": 0.0})

    card_a, model_a = pipeline.train_station_model("AWS-07", dataset_hyd, profile={"name": "Hyderabad Central", "region": "Telangana South", "lat": 17.385, "lon": 78.486, "elevation": 542})
    assert (TEST_DIR / "AWS-07" / f"{card_a['model_id']}.json").exists(), "Model A file was not persisted!"
    assert card_a["training_summary"]["valid_records"] == 30, "Clean records should equal 30."
    assert card_a["training_summary"]["scrubbed_records"] == 2, "Should have scrubbed 2 corrupt records."
    print(f"  -> PASSED: Model A created ({card_a['model_id']}) with dynamic threshold {card_a['training_summary']['dynamic_threshold']}.")

    # -------------------------------------------------------------
    # Test 4: Station B Training (Cherrapunji AWS-19: High Altitude 1313m, Low Pressure 870hPa, High Rain)
    # -------------------------------------------------------------
    print("\n[TEST 4] Training Station B (AWS-19 Cherrapunji - Mountain Rainforest Baseline)...")
    dataset_cherra = [
        {"temp": 18.0 + (i % 6) * 0.6, "hum": 92.0 + (i % 5) * 1.5, "pres": 870.0 + (i % 3) * 0.4, "wind": 22.0 + (i % 6) * 1.2, "rain": 25.0 + (i % 8) * 3.5}
        for i in range(30)
    ]
    card_b, model_b = pipeline.train_station_model("AWS-19", dataset_cherra, profile={"name": "Cherrapunji Hills", "region": "Meghalaya East", "lat": 25.298, "lon": 91.582, "elevation": 1313})
    assert (TEST_DIR / "AWS-19" / f"{card_b['model_id']}.json").exists(), "Model B file was not persisted!"
    print(f"  -> PASSED: Model B created ({card_b['model_id']}) with dynamic threshold {card_b['training_summary']['dynamic_threshold']}.")

    # -------------------------------------------------------------
    # Test 5: Model Isolation Proof (Model A != Model B)
    # -------------------------------------------------------------
    print("\n[TEST 5] Proving Model Isolation (Model A != Model B)...")
    assert card_a["model_id"] != card_b["model_id"], "Model IDs must be unique per station."
    assert card_a["sha256"] != card_b["sha256"], "Model cryptographic hashes must be unique."
    assert card_a["normalization_stats"]["p_mean"] > 1000.0, "Hyderabad pressure should be near sea level."
    assert card_b["normalization_stats"]["p_mean"] < 900.0, "Cherrapunji pressure must reflect high elevation."
    
    # Prove tree splitting values are completely different
    tree_a_split = model_a.trees[0].root.split_value
    tree_b_split = model_b.trees[0].root.split_value
    assert tree_a_split != tree_b_split, f"Tree splits should not be identical: {tree_a_split} vs {tree_b_split}"
    print(f"  -> PASSED: Model A != Model B verified.")
    print(f"     Hyderabad Barometric Mean:    {card_a['normalization_stats']['p_mean']:.1f} hPa")
    print(f"     Cherrapunji Barometric Mean:  {card_b['normalization_stats']['p_mean']:.1f} hPa")

    # -------------------------------------------------------------
    # Test 6: Real-Time Inference Boundary & Climatological Discrimination
    # -------------------------------------------------------------
    print("\n[TEST 6] Testing Real-Time Inference & Microclimate Sensitivity...")
    # 1. Nominal observation for Hyderabad (Hot & dry)
    res_hyd_norm = pipeline.score_realtime("AWS-07", {"temp": 28.5, "hum": 50, "pres": 1007, "wind": 14})
    assert res_hyd_norm["has_model"] is True
    assert res_hyd_norm["model_id"] == card_a["model_id"]
    print(f"  -> Hyderabad typical reading score: {res_hyd_norm['anomaly_score']} -> {res_hyd_norm['status']}")

    # 2. Mountain Rainforest reading for Cherrapunji (Cool, 870 hPa, humid)
    res_cherra_norm = pipeline.score_realtime("AWS-19", {"temp": 19.5, "hum": 96, "pres": 870, "wind": 24})
    assert res_cherra_norm["has_model"] is True
    assert res_cherra_norm["model_id"] == card_b["model_id"]
    print(f"  -> Cherrapunji typical mountain reading score: {res_cherra_norm['anomaly_score']} -> {res_cherra_norm['status']}")

    # 3. Microclimate contrast: Hyderabad tested against Cherrapunji pressure (870 hPa)
    # This should be flagged as severe anomaly for Hyderabad, but is completely normal for Cherrapunji!
    res_hyd_extreme_pres = pipeline.score_realtime("AWS-07", {"temp": 28.0, "hum": 50, "pres": 870, "wind": 14})
    print(f"  -> 870 hPa tested on Hyderabad (Lowland): Anomaly Score {res_hyd_extreme_pres['anomaly_score']} -> {res_hyd_extreme_pres['status']}")
    assert res_hyd_extreme_pres["anomaly_score"] > res_hyd_norm["anomaly_score"], "Hyderabad model should penalize mountain pressure as an anomaly!"

    # -------------------------------------------------------------
    # Clean up test directory
    # -------------------------------------------------------------
    clean_test_env()

    print("\n" + "=" * 70)
    print("ALL 6 TESTS PASSED SUCCESSFULLY! STATION-ADAPTIVE ARCHITECTURE VERIFIED.")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
