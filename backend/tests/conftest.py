"""All backend tests use disposable storage, including standalone test runs."""
import os
import tempfile
from pathlib import Path

_root = Path(tempfile.mkdtemp(prefix="skyguard-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_root / 'tests.db'}"
os.environ["MODEL_STORAGE_PATH"] = str(_root / "models")
os.environ["SKYGUARD_SECRET_KEY"] = "test-secret-not-for-production"
os.environ["DEFAULT_ADMIN_USERNAME"] = "admin"
os.environ["DEFAULT_ADMIN_PASSWORD"] = "sentinel2026"
os.environ["DEMO_MODE"] = "true"
# Bind configuration before legacy test modules set their own environment values.
from backend.app import config  # noqa: E402,F401
