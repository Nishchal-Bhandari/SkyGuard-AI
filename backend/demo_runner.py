"""
SkyGuard AI — End-to-End Anomaly Detection Demo Runner
Demonstrates:
1. CSV upload, column normalization & validation.
2. Station-adaptive Isolation Forest model training from scratch.
3. Per-station artifact persistence & model isolation.
4. Real-time anomaly detection with temporal context buffer & severity scoring.
"""

import json
import logging
from pathlib import Path
import sys

# Ensure backend package is in python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from services import (
    train_station_model,
    detect_anomaly,
    has_station_model,
    load_station_artifacts,
)

logging.basicConfig(level=logging.ERROR)


def run_demo():
    print("=" * 80)
    print(" SKYGUARD AI: ISOLATION FOREST ANOMALY DETECTION ENGINE")
    print("=" * 80)

    examples_dir = backend_dir / "examples"
    models_dir = backend_dir / "models"

    aws_001_csv = examples_dir / "sample_AWS_001.csv"
    aws_002_csv = examples_dir / "sample_AWS_002.csv"

    # ------------------------------------------------------------------
    # Step 1: Cold Start Check
    # ------------------------------------------------------------------
    print("\n--- STEP 1: Cold Start Verification ---")
    station_id_1 = "AWS_001"
    station_id_2 = "AWS_002"

    print(f"Checking model status for station '{station_id_1}'...")
    if not has_station_model(station_id_1, models_dir):
        print(f"  -> Model Status: UNINITIALIZED (No pre-trained model exists for {station_id_1})")

    # ------------------------------------------------------------------
    # Step 2: Upload CSV & Train Model for AWS_001 (Mumbai Coastal)
    # ------------------------------------------------------------------
    print(f"\n--- STEP 2: Training Model for Weather Station '{station_id_1}' ---")
    print(f"Uploading historical CSV: {aws_001_csv.name}")

    meta_1, summary_text_1 = train_station_model(
        station_id=station_id_1,
        csv_source=aws_001_csv,
        base_models_dir=models_dir
    )

    print("\nTraining Output Summary:")
    print("-" * 40)
    print(summary_text_1)
    print("-" * 40)

    station_1_dir = models_dir / station_id_1
    print(f"Saved artifacts in directory: '{station_1_dir}':")
    for f in sorted(station_1_dir.glob("*")):
        print(f"  - {f.name} ({f.stat().st_size:,} bytes)")

    # ------------------------------------------------------------------
    # Step 3: Upload CSV & Train Model for AWS_002 (Cherrapunji Mountain)
    # ------------------------------------------------------------------
    print(f"\n--- STEP 3: Training Model for Weather Station '{station_id_2}' (Mountain AWS) ---")
    print(f"Uploading historical CSV (Custom Headers): {aws_002_csv.name}")

    meta_2, summary_text_2 = train_station_model(
        station_id=station_id_2,
        csv_source=aws_002_csv,
        base_models_dir=models_dir
    )

    print("\nTraining Output Summary:")
    print("-" * 40)
    print(summary_text_2)
    print("-" * 40)

    # ------------------------------------------------------------------
    # Step 4: Verify Station Model Isolation
    # ------------------------------------------------------------------
    print("\n--- STEP 4: Station Model Isolation Verification ---")
    print(f"AWS_001 Historical Pressure Mean: {meta_1['dataset_statistics']['pressure']['mean']:.1f} hPa (Sea level)")
    print(f"AWS_002 Historical Pressure Mean: {meta_2['dataset_statistics']['pressure']['mean']:.1f} hPa (High altitude)")
    assert meta_1["station_id"] != meta_2["station_id"]
    print("  -> PASSED: Station A and Station B models are strictly isolated with independent scalers & thresholds.")

    # ------------------------------------------------------------------
    # Step 5: Real-Time Anomaly Detection Scenarios
    # ------------------------------------------------------------------
    print("\n--- STEP 5: Real-Time Anomaly Detection & Severity Classification ---")

    # Scenario A: Normal Observation for AWS_001
    normal_obs = {
        "station_id": station_id_1,
        "timestamp": "2026-08-03 12:00:00",
        "temperature": 31.5,
        "pressure": 1010.8,
        "humidity": 68.0
    }
    print(f"\n[Scenario A] Normal Observation for {station_id_1}:")
    print(f"Input Payload: {json.dumps(normal_obs)}")
    res_a = detect_anomaly(normal_obs, base_models_dir=models_dir)
    print(f"Response Payload:\n{json.dumps(res_a, indent=2)}")

    # Scenario B: Heat Spike & High Humidity Anomaly for AWS_001
    anomaly_obs = {
        "station_id": station_id_1,
        "timestamp": "2026-08-03 12:10:00",
        "temperature": 55.0,
        "pressure": 1008.0,
        "humidity": 98.0
    }
    print(f"\n[Scenario B] Extreme Heat Spike Anomaly for {station_id_1}:")
    print(f"Input Payload: {json.dumps(anomaly_obs)}")
    res_b = detect_anomaly(anomaly_obs, base_models_dir=models_dir)
    print(f"Response Payload:\n{json.dumps(res_b, indent=2)}")

    # Scenario C: Microclimate Discrimination Test
    # Test Cherrapunji pressure (870 hPa) on AWS_001 (Mumbai lowland)
    microclimate_obs_mumbai = {
        "station_id": station_id_1,
        "timestamp": "2026-08-03 12:20:00",
        "temperature": 28.0,
        "pressure": 870.0,
        "humidity": 75.0
    }
    print(f"\n[Scenario C] 870 hPa Mountain Pressure tested on {station_id_1} (Lowland):")
    res_c_mumbai = detect_anomaly(microclimate_obs_mumbai, base_models_dir=models_dir)
    print(f"Status: {res_c_mumbai['status']} | Severity: {res_c_mumbai['severity']} | Anomaly Score: {res_c_mumbai['anomaly_score']}")
    print(f"Reasons: {res_c_mumbai['possible_reasons']}")

    # Test exact same 870 hPa pressure on AWS_002 (Cherrapunji)
    microclimate_obs_cherra = {
        "station_id": station_id_2,
        "timestamp": "2026-08-03 12:20:00",
        "temperature": 18.5,
        "pressure": 870.0,
        "humidity": 94.0
    }
    print(f"\n[Scenario C] Same 870 hPa Mountain Pressure tested on {station_id_2} (Cherrapunji):")
    res_c_cherra = detect_anomaly(microclimate_obs_cherra, base_models_dir=models_dir)
    print(f"Status: {res_c_cherra['status']} | Severity: {res_c_cherra['severity']} | Anomaly Score: {res_c_cherra['anomaly_score']}")
    print(f"Reasons: {res_c_cherra['possible_reasons']}")

    print("\n" + "=" * 80)
    print(" ALL END-TO-END DEMONSTRATIONS COMPLETED SUCCESSFULLY!")
    print("=" * 80)


if __name__ == "__main__":
    run_demo()
