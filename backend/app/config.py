import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Database Configuration
DATABASE_URL = os.getenv("SKYGUARD_DB_PATH", str(DATA_DIR / "skyguard.db"))

# Security Configuration
SECRET_KEY = os.getenv("SKYGUARD_SECRET_KEY", "skyguard-sentinel-tactical-secret-key-2026-v2")
TOKEN_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24 Hours

# Default Seed Configuration (Used only on clean database first initialization)
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "sentinel2026")
DEFAULT_ADMIN_NAME = os.getenv("DEFAULT_ADMIN_NAME", "Chief Supervisor")
