"""Atomic immutable model artifacts with canonical SHA-256 verification."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from backend.app.config import MODEL_STORAGE_PATH


def artifact_digest(artifact):
    body = dict(artifact)
    body.pop('sha256', None)
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class ModelStorageService:
    def __init__(self, base_path=None):
        self.base_path = Path(base_path or MODEL_STORAGE_PATH).resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def identifier(value):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', value) or value in ('.', '..'):
            raise ValueError('Invalid artifact identifier')
        return value

    def get_station_dir(self, station_id):
        path = self.base_path / self.identifier(station_id.strip().upper())
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_artifact(self, station_id, model_id, artifact):
        path = self.get_station_dir(station_id) / (self.identifier(model_id) + '.json')
        if path.exists():
            raise ValueError('Model artifacts are immutable; use a new version')
        artifact['sha256'] = artifact_digest(artifact)
        fd, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump(artifact, output, sort_keys=True, allow_nan=False)
                output.flush()
                os.fsync(output.fileno())
            # Link creation is atomic and refuses overwriting an existing version.
            os.link(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return str(path)

    def load_artifact(self, model_location):
        path = Path(model_location).resolve()
        if not path.is_relative_to(self.base_path):
            raise ValueError('Artifact location outside model storage')
        if not path.exists():
            return None
        artifact = json.loads(path.read_text(encoding='utf-8'))
        if artifact.get('schema_version', 1) >= 2 and artifact.get('sha256') != artifact_digest(artifact):
            raise ValueError('Artifact integrity verification failed')
        return artifact

    def load_by_station_and_id(self, station_id, model_id):
        return self.load_artifact(str(self.get_station_dir(station_id) / (self.identifier(model_id) + '.json')))


model_storage_service = ModelStorageService()
