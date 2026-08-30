import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Load .env file if it exists (without requiring external python-dotenv dependency)
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    try:
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception as e:
        print(f"[Config] Note: Could not load .env file: {e}")

# Database Configuration
# Cloud PostgreSQL URL format: postgresql://user:pass@host:5432/dbname
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    os.getenv("SKYGUARD_DB_PATH", f"sqlite:///{DATA_DIR / 'skyguard.db'}")
)

# Standardize postgres:// to postgresql:// if needed (e.g. Heroku/older providers)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

DATABASE_SSL_MODE = os.getenv("DATABASE_SSL_MODE", "require")

IS_POSTGRES = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgresql+psycopg2://")

# Model Artifacts Storage
MODEL_STORAGE_PATH = Path(os.getenv("MODEL_STORAGE_PATH", str(PROJECT_ROOT / "ml" / "models")))
MODEL_STORAGE_PATH.mkdir(parents=True, exist_ok=True)

# Security Configuration
SECRET_KEY = os.getenv("SKYGUARD_SECRET_KEY", "skyguard-sentinel-tactical-secret-key-2026-v2")
TOKEN_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 24 Hours

# Default Seed Configuration (Used only on clean database first initialization)
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "sentinel2026")
DEFAULT_ADMIN_NAME = os.getenv("DEFAULT_ADMIN_NAME", "Chief Supervisor")
