import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

from backend.app.config import MODEL_STORAGE_PATH


class ModelStorageService:
    """
    Abstraction layer for station-adaptive model artifact persistence.
    Isolates models physically and logically per station directory:
        {MODEL_STORAGE_PATH}/{station_id}/{model_id}.json
    Separates heavy ML serialized tree structures from database metadata.
    """

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path = Path(base_path or MODEL_STORAGE_PATH)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def get_station_dir(self, station_id: str) -> Path:
        clean_id = station_id.strip().upper()
        station_dir = self.base_path / clean_id
        station_dir.mkdir(parents=True, exist_ok=True)
        return station_dir

    def save_artifact(self, station_id: str, model_id: str, artifact: Dict[str, Any]) -> str:
        """
        Saves full model artifact (model_card + model_weights) to station directory.
        Returns relative or absolute path to the stored artifact.
        """
        clean_id = station_id.strip().upper()
        station_dir = self.get_station_dir(clean_id)
        target_path = station_dir / f"{model_id}.json"

        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(artifact, f, indent=2)

        return str(target_path)

    def load_artifact(self, model_location: str) -> Optional[Dict[str, Any]]:
        """
        Loads the serialized artifact from disk.
        """
        path = Path(model_location)
        if not path.exists():
            return None

        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def load_by_station_and_id(self, station_id: str, model_id: str) -> Optional[Dict[str, Any]]:
        clean_id = station_id.strip().upper()
        target_path = self.get_station_dir(clean_id) / f"{model_id}.json"
        if not target_path.exists():
            return None
        with open(target_path, "r", encoding="utf-8") as f:
            return json.load(f)


model_storage_service = ModelStorageService()
