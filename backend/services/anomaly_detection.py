"""
SkyGuard AI — Real-Time Anomaly Detection Service
Step 8: Real-Time Anomaly Detection, Temporal Context Buffer & Severity Classification

Loads station-specific model artifacts, maintains recent observation buffer per station,
computes 15-feature matrix on live telemetry, scales features, runs Isolation Forest prediction,
and returns calibrated anomaly score, severity level, and explanatory diagnosis.
"""

import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd

from .feature_engineering import scale_realtime_feature_vector, FEATURE_NAMES
from .model_storage import load_station_artifacts, load_recent_buffer, save_recent_buffer, DEFAULT_MODELS_DIR

logger = logging.getLogger(__name__)

# Severity Threshold Boundaries for Calibrated Anomaly Scores
SEVERITY_LEVELS = [
    (0.88, "CRITICAL", "Extremely unusual atmospheric observation / severe sensor anomaly"),
    (0.75, "HIGH", "Strong anomaly observed relative to station microclimate"),
    (0.60, "MEDIUM", "Clearly unusual observation diverging from historical trend"),
    (0.45, "LOW", "Slightly unusual observation"),
    (0.00, "NORMAL", "No anomaly detected; observation aligns with station history")
]


def classify_severity(anomaly_score: float, is_anomaly_flag: bool) -> Tuple[str, str]:
    """
    Maps calibrated anomaly score to human-understandable severity level.
    """
    if not is_anomaly_flag and anomaly_score < 0.45:
        return "NORMAL", "No anomaly detected; observation aligns with station history"

    for threshold, level, description in SEVERITY_LEVELS:
        if anomaly_score >= threshold:
            return level, description

    return "NORMAL", "No anomaly detected"


def generate_possible_reasons(
    obs: Dict[str, Any],
    recent_buffer: List[Dict[str, Any]],
    dataset_stats: Dict[str, Any],
    is_anomaly: bool,
    anomaly_score: float
) -> List[str]:
    """
    Generates human-readable explanations based on feature deltas and station baseline statistics.
    """
    reasons = []
    
    t_curr = float(obs.get("temperature", 0.0))
    p_curr = float(obs.get("pressure", 0.0))
    h_curr = float(obs.get("humidity", 0.0))

    # 1. Delta checks against immediate previous record in buffer
    if len(recent_buffer) > 0:
        prev_obs = recent_buffer[-1]
        t_prev = float(prev_obs.get("temperature", t_curr))
        p_prev = float(prev_obs.get("pressure", p_curr))
        h_prev = float(prev_obs.get("humidity", h_curr))

        t_diff = t_curr - t_prev
        p_diff = p_curr - p_prev
        h_diff = h_curr - h_prev

        if abs(t_diff) >= 3.5:
            direction = "increase" if t_diff > 0 else "drop"
            reasons.append(f"Sudden temperature {direction} compared with recent readings ({t_diff:+.1f}°C)")

        if abs(p_diff) >= 4.0:
            direction = "rise" if p_diff > 0 else "drop"
            reasons.append(f"Rapid barometric pressure {direction} ({p_diff:+.1f} hPa)")

        if abs(h_diff) >= 20.0:
            direction = "surge" if h_diff > 0 else "drop"
            reasons.append(f"Abrupt relative humidity {direction} ({h_diff:+.1f}%)")

    # 2. Historical station baseline z-score / bounds check
    t_stats = dataset_stats.get("temperature", {})
    p_stats = dataset_stats.get("pressure", {})
    h_stats = dataset_stats.get("humidity", {})

    if t_stats and (t_curr < t_stats.get("min", -50) - 2.0 or t_curr > t_stats.get("max", 60) + 2.0):
        reasons.append(f"Temperature ({t_curr}°C) exceeds historical station limits [{t_stats.get('min')}°C to {t_stats.get('max')}°C]")

    if p_stats and (p_curr < p_stats.get("min", 700) - 5.0 or p_curr > p_stats.get("max", 1100) + 5.0):
        reasons.append(f"Pressure ({p_curr} hPa) exceeds historical station limits [{p_stats.get('min')} hPa to {p_stats.get('max')} hPa]")

    if h_stats and (h_curr < 0 or h_curr > 100):
        reasons.append(f"Humidity reading ({h_curr}%) violates physical bounds [0-100%]")

    # Generic fallback reason if anomaly is detected by tree multidimensional splits
    if is_anomaly and not reasons:
        reasons.append("Observation differs significantly from historical station patterns")

    if not is_anomaly and not reasons:
        reasons.append("Observation is consistent with historical station microclimate and recent trend")

    return reasons


def detect_anomaly(
    observation: Dict[str, Any],
    base_models_dir: Path = DEFAULT_MODELS_DIR
) -> Dict[str, Any]:
    """
    Performs real-time anomaly detection for an incoming weather station observation.
    
    Expected Observation Schema:
    {
        "station_id": "AWS_001",
        "timestamp": "2026-08-29 14:30:00",
        "temperature": 55.0,
        "pressure": 1008.0,
        "humidity": 98.0
    }
    
    Returns structured result dict.
    """
    station_id = observation.get("station_id")
    if not station_id:
        raise ValueError("Missing 'station_id' in real-time observation request.")

    # 1. Load Station Model Artifacts
    model, scaler, feature_config, metadata = load_station_artifacts(station_id, base_models_dir)

    # 2. Maintain Station Temporal Context Buffer
    recent_buffer = load_recent_buffer(station_id, base_models_dir)

    ts_str = str(observation.get("timestamp", pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")))
    ts_dt = pd.to_datetime(ts_str, errors="coerce")
    if pd.isna(ts_dt):
        ts_dt = pd.Timestamp.now()

    curr_record = {
        "timestamp": ts_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "temperature": float(observation.get("temperature", observation.get("temp", 25.0))),
        "pressure": float(observation.get("pressure", observation.get("pres", 1013.25))),
        "humidity": float(observation.get("humidity", observation.get("hum", 50.0)))
    }

    # Build evaluation window (buffer + current observation)
    eval_list = list(recent_buffer) + [curr_record]
    df_eval = pd.DataFrame(eval_list)
    df_eval["timestamp"] = pd.to_datetime(df_eval["timestamp"])

    # 3. Calculate 15 Features for the observation
    df_eval["hour"] = df_eval["timestamp"].dt.hour
    df_eval["day_of_year"] = df_eval["timestamp"].dt.dayofyear
    df_eval["month"] = df_eval["timestamp"].dt.month

    df_eval["temperature_change"] = df_eval["temperature"].diff().fillna(0.0)
    df_eval["pressure_change"] = df_eval["pressure"].diff().fillna(0.0)
    df_eval["humidity_change"] = df_eval["humidity"].diff().fillna(0.0)

    for param in ["temperature", "pressure", "humidity"]:
        rolling_obj = df_eval[param].rolling(window=3, min_periods=1)
        df_eval[f"{param}_rolling_mean"] = rolling_obj.mean().fillna(df_eval[param])
        df_eval[f"{param}_rolling_std"] = rolling_obj.std().fillna(0.0)

    # Extract target feature dictionary for current record (last row)
    target_row = df_eval.iloc[-1]
    feature_dict = {name: float(target_row[name]) for name in FEATURE_NAMES}

    # 4. Apply StandardScaler and Predict via Isolation Forest
    X_scaled = scale_realtime_feature_vector(feature_dict, scaler, FEATURE_NAMES)

    pred = model.predict(X_scaled)[0]  # -1 for anomaly, 1 for normal
    is_anomaly = (pred == -1)

    raw_score = model.score_samples(X_scaled)[0]
    # Calibrate score to [0.0, 1.0] range where higher = more anomalous
    calibrated_score = round(float(np.clip(0.5 - (raw_score / 2.0), 0.0, 1.0)), 4)

    # 5. Classify Severity
    severity, severity_desc = classify_severity(calibrated_score, is_anomaly)

    # 6. Generate Diagnosis Reasons
    dataset_stats = metadata.get("dataset_statistics", {})
    reasons = generate_possible_reasons(curr_record, recent_buffer, dataset_stats, is_anomaly, calibrated_score)

    # 7. Update and persist recent buffer (keep max 15 recent observations)
    updated_buffer = eval_list[-15:]
    save_recent_buffer(station_id, updated_buffer, base_models_dir)

    status_str = "ANOMALY" if is_anomaly or severity != "NORMAL" else "NORMAL"

    return {
        "station_id": station_id,
        "timestamp": curr_record["timestamp"],
        "status": status_str,
        "is_anomaly": is_anomaly,
        "anomaly_score": calibrated_score,
        "severity": severity,
        "severity_description": severity_desc,
        "possible_reasons": reasons,
        "observation": {
            "temperature": curr_record["temperature"],
            "pressure": curr_record["pressure"],
            "humidity": curr_record["humidity"]
        },
        "model_version": metadata.get("model_version", "v1.0")
    }
