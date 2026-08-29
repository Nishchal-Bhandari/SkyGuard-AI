"""
SkyGuard AI — Station Model Storage Service
Step 7: Save the Model Per Weather Station

Persists and retrieves station-isolated ML artifacts:
- isolation_forest.pkl
- scaler.pkl
- feature_config.json
- model_metadata.json
- recent_buffer.json

Guarantees 100% strict isolation between station IDs.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

import joblib
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

DEFAULT_MODELS_DIR = Path("backend/models")


def get_station_dir(station_id: str, base_dir: Path = DEFAULT_MODELS_DIR) -> Path:
    """Returns the dedicated directory for a weather station, creating it if needed."""
    # Sanitize station_id to prevent path traversal
    safe_station_id = "".join(c for c in station_id if c.isalnum() or c in ("-", "_")).strip()
    if not safe_station_id:
        raise ValueError(f"Invalid station_id: '{station_id}'")
    
    station_dir = base_dir / safe_station_id
    station_dir.mkdir(parents=True, exist_ok=True)
    return station_dir


def has_station_model(station_id: str, base_dir: Path = DEFAULT_MODELS_DIR) -> bool:
    """Checks if a fully trained Isolation Forest model and scaler exist for station_id."""
    station_dir = get_station_dir(station_id, base_dir)
    model_file = station_dir / "isolation_forest.pkl"
    scaler_file = station_dir / "scaler.pkl"
    metadata_file = station_dir / "model_metadata.json"
    return model_file.exists() and scaler_file.exists() and metadata_file.exists()


def save_station_artifacts(
    station_id: str,
    model: IsolationForest,
    scaler: StandardScaler,
    feature_config: Dict[str, Any],
    metadata: Dict[str, Any],
    recent_buffer: Optional[list] = None,
    base_dir: Path = DEFAULT_MODELS_DIR
) -> Path:
    """
    Saves all model artifacts specifically for the given weather station ID.
    """
    station_dir = get_station_dir(station_id, base_dir)

    # 1. Save Isolation Forest model
    joblib.dump(model, station_dir / "isolation_forest.pkl")

    # 2. Save StandardScaler
    joblib.dump(scaler, station_dir / "scaler.pkl")

    # 3. Save Feature Config JSON
    with open(station_dir / "feature_config.json", "w", encoding="utf-8") as f:
        json.dump(feature_config, f, indent=2)

    # 4. Save Model Metadata JSON
    with open(station_dir / "model_metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    # 5. Save recent buffer if provided
    if recent_buffer is not None:
        save_recent_buffer(station_id, recent_buffer, base_dir)

    logger.info(f"Successfully saved station model artifacts for '{station_id}' at '{station_dir}'")
    return station_dir


def load_station_artifacts(
    station_id: str,
    base_dir: Path = DEFAULT_MODELS_DIR
) -> Tuple[IsolationForest, StandardScaler, Dict[str, Any], Dict[str, Any]]:
    """
    Loads model, scaler, feature config, and metadata for a specific station ID.
    Raises FileNotFoundError if model does not exist.
    """
    if not has_station_model(station_id, base_dir):
        raise FileNotFoundError(
            f"No trained anomaly detection model found for weather station '{station_id}'. "
            "Please upload station historical CSV data to train a model."
        )

    station_dir = get_station_dir(station_id, base_dir)

    model = joblib.load(station_dir / "isolation_forest.pkl")
    scaler = joblib.load(station_dir / "scaler.pkl")

    with open(station_dir / "feature_config.json", "r", encoding="utf-8") as f:
        feature_config = json.load(f)

    with open(station_dir / "model_metadata.json", "r", encoding="utf-8") as f:
        metadata = json.load(f)

    return model, scaler, feature_config, metadata


def save_recent_buffer(
    station_id: str,
    buffer_records: list,
    base_dir: Path = DEFAULT_MODELS_DIR
) -> None:
    """Saves recent historical observation buffer for temporal feature calculation."""
    station_dir = get_station_dir(station_id, base_dir)
    buffer_file = station_dir / "recent_buffer.json"
    with open(buffer_file, "w", encoding="utf-8") as f:
        json.dump(buffer_records, f, indent=2)


def load_recent_buffer(
    station_id: str,
    base_dir: Path = DEFAULT_MODELS_DIR
) -> list:
    """Loads recent observation buffer for station_id. Returns empty list if not found."""
    station_dir = get_station_dir(station_id, base_dir)
    buffer_file = station_dir / "recent_buffer.json"
    if not buffer_file.exists():
        return []

    try:
        with open(buffer_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Could not load recent buffer for station '{station_id}': {e}")
        return []
