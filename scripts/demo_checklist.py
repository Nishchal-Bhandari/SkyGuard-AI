#!/usr/bin/env python3
"""Automated Demo Checklist

Steps performed:
1. **Seed stations** – ensure required stations exist in the DB.
2. **Load deterministic telemetry** from `test_weather.csv` into the `telemetry` table.
3. **Run deterministic replay** using the existing `offline_replay.py` script.
4. **Backup the database** (SQLite file) to a timestamped copy.
5. **Restore the database** from the backup to verify backup‑restore works.
6. **Rehearsals** – run the replay a few times to simulate repeated demo runs.

The script is self‑contained, uses only local files and the existing
backend storage APIs, and therefore does *not* hit any external services.
"""

import os
import shutil
import csv
import datetime
import subprocess
from pathlib import Path

# Project imports – adjust PYTHONPATH if executed from the repo root
import sys
sys.path.append(str(Path(__file__).resolve().parents[0]))  # repo root

from backend.app.storage.database import get_db, insert_telemetry_batch, init_db
from backend.app.config import DATABASE_URL, IS_POSTGRES

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def db_path() -> Path:
    """Return the absolute path to the SQLite DB file (used in dev mode)."""
    if IS_POSTGRES:
        raise RuntimeError("Demo checklist only supports the local SQLite database.")
    # DATABASE_URL is in the form "sqlite:///path/to/file.db"
    url = DATABASE_URL
    if url.startswith("sqlite:///"):
        return Path(url[10:])
    raise RuntimeError(f"Unexpected DATABASE_URL format: {url}")

def backup_database():
    src = db_path()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = src.parent / f"skyguard_backup_{timestamp}.db"
    shutil.copy2(src, backup)
    print(f"Database backed up to {backup}")
    return backup

def restore_database(backup_path: Path):
    src = db_path()
    shutil.copy2(backup_path, src)
    print(f"Database restored from {backup_path}")

def seed_stations_from_csv(csv_path: Path):
    """Insert any stations referenced in the CSV that are not already present."""
    stations = {}
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row.get("station_id", "").strip().upper()
            if not sid:
                continue
            # Use placeholder values for required fields; these are not used in the demo logic.
            stations[sid] = {
                "station_id": sid,
                "station_name": f"Demo {sid}",
                "username": f"demo_{sid.lower()}",
                "password_hash": "hash",  # placeholder – real auth not exercised in demo
                "latitude": 0.0,
                "longitude": 0.0,
                "elevation": 0.0,
                "region": "Demo",
                "status": "ACTIVE",
            }
    # Insert missing stations directly via SQL
    with get_db() as conn:
        cur = conn.cursor()
        for sid, data in stations.items():
            cur.execute("SELECT 1 FROM stations WHERE station_id = ?", (sid,))
            if cur.fetchone():
                continue  # already present
            cur.execute(
                """INSERT INTO stations (station_id, station_name, username, password_hash, latitude, longitude, elevation, region, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data["station_id"],
                    data["station_name"],
                    data["username"],
                    data["password_hash"],
                    data["latitude"],
                    data["longitude"],
                    data["elevation"],
                    data["region"],
                    data["status"],
                ),
            )
        conn.commit()
    print(f"Seeded {len(stations)} stations into the DB.")

def load_telemetry_from_csv(csv_path: Path):
    """Read CSV rows and bulk‑insert them via `insert_telemetry_batch`."""
    rows_by_station = {}
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row.get("station_id", "").strip().upper()
            if not sid:
                continue
            rows_by_station.setdefault(sid, []).append({
                "timestamp": row.get("timestamp"),
                "temp": float(row.get("temperature_c", 0)),
                "hum": float(row.get("humidity_pct", 0)),
                "pres": float(row.get("pressure_hpa", 0)),
                "wind": float(row.get("wind_speed_kmh", 0)),
                "rain": float(row.get("rainfall_mm", 0)),
                # other fields can be omitted – defaults will be used
            })
    # Bulk insert per station
    for sid, rows in rows_by_station.items():
        insert_telemetry_batch(sid, rows)
    print(f"Loaded telemetry for {len(rows_by_station)} stations from {csv_path.name}.")

def run_replay(station_id: str):
    """Execute the offline replay script for a given station."""
    subprocess.run(["python", "scripts/offline_replay.py", "--station", station_id], check=True)

def rehearsals(station_id: str, count: int = 3):
    """Run the replay a few times to simulate a demo rehearsal."""
    for i in range(1, count + 1):
        print(f"Rehearsal {i}/{count} for station {station_id}")
        run_replay(station_id)

def main():
    # Ensure DB schema exists
    init_db()

    csv_file = Path("test_weather.csv")
    if not csv_file.is_file():
        raise FileNotFoundError(f"Test data CSV not found: {csv_file}")

    # 1. Seed stations
    seed_stations_from_csv(csv_file)

    # 2. Load deterministic telemetry
    load_telemetry_from_csv(csv_file)

    # 3. Deterministic replay (once)
    # Determine a sample station ID from the CSV (first row)
    with csv_file.open(newline='') as f:
        reader = csv.DictReader(f)
        first_row = next(reader)
        sample_station = first_row["station_id"].strip().upper()
    print(f"Running initial replay for station {sample_station}")
    run_replay(sample_station)

    # 4. Backup DB
    backup_path = backup_database()

    # 5. Restore DB (to confirm process works)
    restore_database(backup_path)

    # 6. Rehearsals
    rehearsals(sample_station, count=3)

    print("Demo checklist completed successfully.")

if __name__ == "__main__":
    main()
