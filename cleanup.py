import shutil
from pathlib import Path
from backend.app.storage.database import get_db

print("Starting database cleanup...")

try:
    with get_db() as conn:
        cur = conn.cursor()
        
        # Delete all telemetry data
        print("Deleting telemetry data...")
        cur.execute("DELETE FROM telemetry;")
        
        # Delete all training jobs
        print("Deleting training jobs...")
        cur.execute("DELETE FROM training_jobs;")
        
        # Delete all models from model registry
        print("Deleting model registry records...")
        cur.execute("DELETE FROM model_registry;")
        
        # Also clear the models table just in case
        print("Deleting legacy models table records...")
        cur.execute("DELETE FROM models;")
        
        print("Database cleanup completed successfully.")
except Exception as e:
    print(f"Error during database cleanup: {e}")

# Delete model artifact files
print("\nStarting artifact cleanup...")
model_dir = Path("ml/models")
if model_dir.exists():
    for item in model_dir.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
            print(f"Deleted directory: {item}")
        else:
            item.unlink()
            print(f"Deleted file: {item}")
    print("Artifact cleanup completed successfully.")
else:
    print("Artifact directory 'ml/models' does not exist, nothing to clean.")

print("All cleanup tasks completed.")
