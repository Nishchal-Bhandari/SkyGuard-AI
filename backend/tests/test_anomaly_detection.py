"""
SkyGuard AI — Automated Test Suite for Isolation Forest Anomaly Detection Module
"""

import io
import shutil
from pathlib import Path
import pytest
import pandas as pd
import numpy as np

from backend.services import (
    validate_and_preprocess_csv,
    normalize_columns,
    extract_features,
    train_station_model,
    detect_anomaly,
    has_station_model,
    load_station_artifacts,
    FEATURE_NAMES
)

TEST_MODELS_DIR = Path("backend/tests/test_models")


@pytest.fixture(autouse=True)
def clean_test_models_dir():
    """Ensures clean temporary model storage directory for tests."""
    if TEST_MODELS_DIR.exists():
        shutil.rmtree(TEST_MODELS_DIR)
    TEST_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    yield
    if TEST_MODELS_DIR.exists():
        shutil.rmtree(TEST_MODELS_DIR)


def test_column_normalization():
    """Test column normalization with various alias combinations."""
    raw_df = pd.DataFrame({
        "Date_Time": ["2026-08-01 10:00:00"],
        "Temp_C": [28.5],
        "Pres_hPa": [1008.2],
        "Hum_pct": [72]
    })
    df_norm, mapping = normalize_columns(raw_df)
    assert set(df_norm.columns) == {"timestamp", "temperature", "pressure", "humidity"}
    assert df_norm["temperature"].iloc[0] == 28.5


def test_invalid_csv_columns():
    """Test error raising when mandatory columns are missing."""
    invalid_df = pd.DataFrame({
        "timestamp": ["2026-08-01 10:00:00"],
        "temperature": [28.5]
    })
    with pytest.raises(ValueError) as excinfo:
        validate_and_preprocess_csv(invalid_df)
    assert "Missing required column(s)" in str(excinfo.value)


def test_hardware_sentinel_scrubbing():
    """Test scrubbing of hardware sentinel flags (-999, 9999) and interpolation."""
    df_with_sentinels = pd.DataFrame({
        "timestamp": [
            "2026-08-01 10:00:00",
            "2026-08-01 10:10:00",
            "2026-08-01 10:20:00"
        ],
        "temperature": [25.0, -999.0, 27.0],
        "pressure": [1010.0, 1010.0, 9999.0],
        "humidity": [70.0, 72.0, 74.0]
    })
    df_clean, summary = validate_and_preprocess_csv(df_with_sentinels)
    assert summary["corrupted_values_scrubbed"] > 0
    # Interpolation should replace -999 with mean of 25 and 27 (26.0)
    assert df_clean["temperature"].iloc[1] == 26.0


def test_feature_engineering_structure():
    """Test standard 15 feature extraction."""
    timestamps = pd.date_range("2026-08-01", periods=10, freq="1h")
    df = pd.DataFrame({
        "timestamp": timestamps,
        "temperature": [25.0 + i * 0.5 for i in range(10)],
        "pressure": [1010.0 - i * 0.2 for i in range(10)],
        "humidity": [60.0 + i * 1.0 for i in range(10)]
    })
    df_feat, names = extract_features(df, window_size=3)
    assert len(names) == 15
    assert list(df_feat.columns) == FEATURE_NAMES
    assert df_feat.isna().sum().sum() == 0


def test_station_model_training_and_isolation():
    """Test training from scratch and strict per-station isolation."""
    # Build dataset for Station A (Lowland AWS-001)
    timestamps = pd.date_range("2026-08-01", periods=30, freq="1h")
    df_a = pd.DataFrame({
        "timestamp": timestamps,
        "temperature": np.random.uniform(25.0, 32.0, 30),
        "pressure": np.random.uniform(1008.0, 1012.0, 30),
        "humidity": np.random.uniform(60.0, 80.0, 30)
    })

    # Build dataset for Station B (Highland AWS-002)
    df_b = pd.DataFrame({
        "timestamp": timestamps,
        "temperature": np.random.uniform(14.0, 20.0, 30),
        "pressure": np.random.uniform(865.0, 875.0, 30),
        "humidity": np.random.uniform(85.0, 98.0, 30)
    })

    meta_a, text_a = train_station_model("TEST_AWS_001", df_a, base_models_dir=TEST_MODELS_DIR)
    meta_b, text_b = train_station_model("TEST_AWS_002", df_b, base_models_dir=TEST_MODELS_DIR)

    # Check persistence
    assert (TEST_MODELS_DIR / "TEST_AWS_001" / "isolation_forest.pkl").exists()
    assert (TEST_MODELS_DIR / "TEST_AWS_001" / "scaler.pkl").exists()
    assert (TEST_MODELS_DIR / "TEST_AWS_002" / "isolation_forest.pkl").exists()

    # Check station statistics isolation
    assert meta_a["dataset_statistics"]["pressure"]["mean"] > 1000.0
    assert meta_b["dataset_statistics"]["pressure"]["mean"] < 900.0


def test_realtime_anomaly_detection_flow():
    """Test real-time anomaly detection and severity mapping."""
    timestamps = pd.date_range("2026-08-01", periods=30, freq="1h")
    df_train = pd.DataFrame({
        "timestamp": timestamps,
        "temperature": [25.0 + (i % 5) * 0.5 for i in range(30)],
        "pressure": [1010.0 for _ in range(30)],
        "humidity": [70.0 for _ in range(30)]
    })
    train_station_model("TEST_AWS_REALTIME", df_train, base_models_dir=TEST_MODELS_DIR)

    # 1. Test normal observation
    obs_norm = {
        "station_id": "TEST_AWS_REALTIME",
        "timestamp": "2026-08-02 12:00:00",
        "temperature": 25.5,
        "pressure": 1010.0,
        "humidity": 70.0
    }
    res_norm = detect_anomaly(obs_norm, base_models_dir=TEST_MODELS_DIR)
    assert res_norm["status"] == "NORMAL"
    assert res_norm["severity"] == "NORMAL"

    # 2. Test anomalous observation (extreme temperature spike)
    obs_anom = {
        "station_id": "TEST_AWS_REALTIME",
        "timestamp": "2026-08-02 12:10:00",
        "temperature": 55.0,
        "pressure": 1010.0,
        "humidity": 70.0
    }
    res_anom = detect_anomaly(obs_anom, base_models_dir=TEST_MODELS_DIR)
    assert res_anom["status"] == "ANOMALY"
    assert res_anom["severity"] in ["HIGH", "CRITICAL"]
    assert len(res_anom["possible_reasons"]) > 0


if __name__ == "__main__":
    pytest.main(["-v", __file__])
