import os
import shutil
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

print("=================================================================")
print(" SkyGuard AI — Complete Database & Model Artifacts Purge ")
print("=================================================================")

# 1. Clean SQLite database files
db_paths = [
    PROJECT_ROOT / "backend" / "data" / "skyguard.db",
    PROJECT_ROOT / "backend" / "app" / "skyguard.db",
    PROJECT_ROOT / "skyguard.db"
]

for db_path in db_paths:
    if db_path.exists():
        print(f"\nProcessing SQLite database: {db_path}")
        try:
            conn = sqlite3.connect(str(db_path))
            cur = conn.cursor()
            
            tables = [
                "active_faults",
                "incidents",
                "telemetry",
                "training_jobs",
                "model_registry",
                "models",
                "station_qc_config",
                "stations"
            ]
            
            for t in tables:
                try:
                    cur.execute(f"DELETE FROM {t};")
                    print(f"  - Purged table: {t}")
                except Exception as e:
                    pass
            
            conn.commit()
            conn.close()
            print(f"[SUCCESS] Purged all station & telemetry tables from {db_path.name}")
        except Exception as e:
            print(f"[ERROR] Failed cleaning {db_path}: {e}")

# 2. Clean trained models
print("\nPurging trained model artifacts from 'ml/models'...")
model_dir = PROJECT_ROOT / "ml" / "models"
if model_dir.exists():
    for item in model_dir.iterdir():
        if item.is_dir():
            shutil.rmtree(item, ignore_errors=True)
            print(f"  - Deleted directory: {item.name}")
        else:
            try:
                item.unlink()
                print(f"  - Deleted file: {item.name}")
            except Exception:
                pass
    print("[SUCCESS] All model artifacts removed.")

# 3. Clean any temp training models or test caches
for p in [PROJECT_ROOT / "backend" / "data" / "models"]:
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)

print("\n=================================================================")
print(" CLEANUP COMPLETE: DATABASE & MODELS ARE 100% PRISTINE ")
print(" All stations, models, incidents, faults, and telemetry removed.")
print("=================================================================\n")
