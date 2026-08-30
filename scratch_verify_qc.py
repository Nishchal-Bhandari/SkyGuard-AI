import os
import sys

# Add project root to sys.path
sys.path.insert(0, r"d:\SkyGuard-AI")

from backend.app.storage.database import init_db, calibrate_station_qc, get_station_qc_config

print("Initializing DB...")
init_db()

print("Calibrating AWS-01...")
aws01_qc = calibrate_station_qc("AWS-01")
print(f"AWS-01 QC: {aws01_qc}")

print("Checking AWS-02 QC (Should be None)...")
aws02_qc = get_station_qc_config("AWS-02")
print(f"AWS-02 QC: {aws02_qc}")

print("Calibrating AWS-02 (Should return None if no data, or distinct if data exists)...")
aws02_qc_calib = calibrate_station_qc("AWS-02")
print(f"AWS-02 Calibrated QC: {aws02_qc_calib}")
