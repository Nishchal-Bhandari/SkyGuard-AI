"""
SkyGuard AI — Model Training Service
Step 5: Train Isolation Forest & Step 6: Generate Training Results

Orchestrates CSV preprocessing, feature engineering, StandardScaler fitting,
Isolation Forest model fitting from scratch, result generation, and artifact saving per station.
"""

from datetime import datetime
import logging
from pathlib import Path
from typing import Dict, Any, Union, Tuple, Optional
import io

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .data_preprocessing import validate_and_preprocess_csv
from .feature_engineering import extract_features, fit_and_scale_features, FEATURE_NAMES
from .model_storage import save_station_artifacts, DEFAULT_MODELS_DIR

logger = logging.getLogger(__name__)


def train_station_model(
    station_id: str,
    csv_source: Union[str, Path, io.BytesIO, io.StringIO, pd.DataFrame],
    n_estimators: int = 200,
    contamination: Union[str, float] = "auto",
    random_state: int = 42,
    base_models_dir: Path = DEFAULT_MODELS_DIR
) -> Tuple[Dict[str, Any], str]:
    """
    Trains a dedicated Isolation Forest model from scratch using uploaded CSV data for a specific weather station.
    
    Returns:
        (training_summary_dict, formatted_summary_text)
    """
    if not station_id or not str(station_id).strip():
        raise ValueError("A valid 'station_id' must be provided for model training.")

    station_id = str(station_id).strip()

    # 1. Step 1 & 2: CSV Validation & Data Preprocessing
    df_cleaned, preprocessing_summary = validate_and_preprocess_csv(csv_source)

    min_required_records = 10
    if len(df_cleaned) < min_required_records:
        raise ValueError(
            f"Insufficient valid historical data for station '{station_id}'. "
            f"Found {len(df_cleaned)} valid records after cleaning (minimum {min_required_records} required)."
        )

    # 2. Step 3: Feature Engineering
    df_features, feature_names = extract_features(df_cleaned, window_size=3)

    # 3. Step 4: Feature Scaling (StandardScaler)
    X_scaled, scaler = fit_and_scale_features(df_features)

    # 4. Step 5: Train Isolation Forest from Scratch
    iforest = IsolationForest(
        n_estimators=n_estimators,
        contamination=contamination,
        random_state=random_state,
        n_jobs=-1
    )
    iforest.fit(X_scaled)

    # Predict anomalies on historical training data (-1: Anomaly, 1: Normal)
    predictions = iforest.predict(X_scaled)
    # Convert raw scikit-learn decision scores to normalized anomaly scores [0, 1]
    # score_samples returns opposite of anomaly score (lower/more negative = more anomalous)
    raw_scores = iforest.score_samples(X_scaled)
    # Calibrate score: decision threshold is roughly 0.0 in score_samples
    # Normalized score: 0.5 - raw_scores / 2.0 (clamped between 0 and 1)
    normalized_scores = np.clip(0.5 - (raw_scores / 2.0), 0.0, 1.0)

    is_anomaly_mask = (predictions == -1)
    anomaly_count = int(is_anomaly_mask.sum())
    total_records = len(df_cleaned)
    anomaly_percentage = round((anomaly_count / total_records) * 100.0, 2)

    # Calculate Anomaly Score Distribution Statistics
    score_dist = {
        "min": round(float(np.min(normalized_scores)), 4),
        "max": round(float(np.max(normalized_scores)), 4),
        "mean": round(float(np.mean(normalized_scores)), 4),
        "median": round(float(np.median(normalized_scores)), 4),
        "p25": round(float(np.percentile(normalized_scores, 25)), 4),
        "p75": round(float(np.percentile(normalized_scores, 75)), 4),
        "p95": round(float(np.percentile(normalized_scores, 95)), 4)
    }

    # Calculate Parameter Dataset Statistics
    dataset_stats = {}
    for param in ["temperature", "pressure", "humidity"]:
        dataset_stats[param] = {
            "min": round(float(df_cleaned[param].min()), 2),
            "max": round(float(df_cleaned[param].max()), 2),
            "mean": round(float(df_cleaned[param].mean()), 2),
            "std": round(float(df_cleaned[param].std()), 2)
        }

    # 5. Build Metadata & Feature Config Payloads
    feature_config = {
        "station_id": station_id,
        "feature_names": feature_names,
        "feature_count": len(feature_names),
        "window_size": 3,
        "base_parameters": ["temperature", "pressure", "humidity"]
    }

    model_metadata = {
        "station_id": station_id,
        "model_version": "v1.0",
        "training_date": datetime.now().isoformat(),
        "total_records": total_records,
        "anomalies_detected": anomaly_count,
        "anomaly_percentage": anomaly_percentage,
        "feature_count": len(feature_names),
        "feature_names": feature_names,
        "hyperparameters": {
            "n_estimators": n_estimators,
            "contamination": contamination,
            "random_state": random_state
        },
        "score_distribution": score_dist,
        "dataset_statistics": dataset_stats,
        "preprocessing_summary": preprocessing_summary,
        "model_status": "READY"
    }

    # Extract recent observations buffer (last 10 records) to seed real-time temporal context
    recent_buffer_records = []
    tail_df = df_cleaned.tail(10)
    for _, row in tail_df.iterrows():
        recent_buffer_records.append({
            "timestamp": row["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
            "temperature": float(row["temperature"]),
            "pressure": float(row["pressure"]),
            "humidity": float(row["humidity"])
        })

    # 6. Step 7: Save Station Artifacts Per Weather Station
    save_station_artifacts(
        station_id=station_id,
        model=iforest,
        scaler=scaler,
        feature_config=feature_config,
        metadata=model_metadata,
        recent_buffer=recent_buffer_records,
        base_dir=base_models_dir
    )

    # 7. Build Formatted Training Results Summary Text
    formatted_summary_text = (
        f"Model Training Complete\n\n"
        f"Station ID: {station_id}\n"
        f"Total Records: {total_records:,}\n"
        f"Features Used: {len(feature_names)}\n"
        f"Detected Historical Anomalies: {anomaly_count:,}\n"
        f"Anomaly Percentage: {anomaly_percentage}%\n\n"
        f"Model Status: READY"
    )

    logger.info(f"Model training complete for station '{station_id}'. Status: READY.")
    return model_metadata, formatted_summary_text
