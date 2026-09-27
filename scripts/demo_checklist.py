#!/usr/bin/env python3
"""Automated Demo Checklist

Steps performed:
1. Seed stations with real coordinates.
2. Load deterministic telemetry from test_weather.csv.
3. Run deterministic replay via offline_replay.py.
4. Backup the SQLite DB, validate restore.
5. Rehearsals (3 replay runs).

Uses only local files - no external services.
"""

import os
import shutil
import csv
import hashlib
import datetime
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.storage.database import get_db, insert_telemetry_batch, init_db
from backend.app.config import DATABASE_URL, IS_POSTGRES

# Real station coordinates for demo
DEMO_STATIONS = {
    "AWS-01": {"name": "Bengaluru Urban", "lat": 12.9716, "lon": 77.5946, "elev": 920, "region": "Deccan Plateau"},
    "AWS-07": {"name": "Hyderabad Deccan", "lat": 17.385, "lon": 78.486, "elev": 542, "region": "Deccan"},
    "AWS-08": {"name": "Visakhapatnam Coast", "lat": 17.686, "lon": 83.218, "elev": 45, "region": "Eastern Coast"},
}


def db_path() -> Path:
    if IS_POSTGRES:
        raise RuntimeError("Demo checklist only supports the local SQLite database.")
    url = DATABASE_URL
    if url.startswith("sqlite:///"):
        return Path(url[10:])
    raise RuntimeError(f"Unexpected DATABASE_URL format: {url}")


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def backup_database() -> Path:
    src = db_path()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = src.parent / f"skyguard_backup_{timestamp}.db"
    shutil.copy2(src, backup)
    print(f"Database backed up to {backup}")
    return backup


def restore_database(backup_path: Path) -> None:
    src = db_path()
    shutil.copy2(backup_path, src)
    print(f"Database restored from {backup_path}")


def seed_demo_stations():
    with get_db() as conn:
        cur = conn.cursor()
        for sid, info in DEMO_STATIONS.items():
            cur.execute("SELECT 1 FROM stations WHERE station_id = ?", (sid,))
            if cur.fetchone():
                cur.execute(
                    """UPDATE stations SET station_name = ?, latitude = ?, longitude = ?, elevation = ?, region = ?, status = 'ACTIVE'
                       WHERE station_id = ?""",
                    (info["name"], info["lat"], info["lon"], info["elev"], info["region"], sid),
                )
                continue
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            cur.execute(
                """INSERT INTO stations (station_id, station_name, username, password_hash,
                   latitude, longitude, elevation, region, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (sid, info["name"], f"demo_{sid.lower()}", "hash",
                 info["lat"], info["lon"], info["elev"], info["region"], "ACTIVE", now, now),
            )
        conn.commit()
    print(f"Seeded {len(DEMO_STATIONS)} demo stations.")


def load_telemetry_from_csv(csv_path: Path):
    rows_by_station = {}
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = (row.get("station_id") or "AWS-01").strip().upper()
            ts = row.get("timestamp") or row.get("date") or row.get("time")
            if not ts:
                raise ValueError("Demo CSV requires a timestamp/date/time column")
            rows_by_station.setdefault(sid, []).append({
                "timestamp": ts,
                "temp": float(row.get("temperature_c", row.get("temp", row.get("temperature", 0)))),
                "hum": float(row.get("humidity_pct", row.get("hum", row.get("humidity", 0)))),
                "pres": float(row.get("pressure_hpa", row.get("pres", row.get("pressure", 0)))),
                "wind": float(row.get("wind_speed_kmh", row.get("wind", row.get("wind_speed", 0)))),
                "rain": float(row.get("rainfall_mm", row.get("rain", row.get("rainfall", 0)))),
            })
    if not rows_by_station:
        raise ValueError("Demo CSV contains no usable telemetry rows")
    for sid, rows in rows_by_station.items():
        insert_telemetry_batch(sid, rows)
    print(f"Loaded telemetry for {len(rows_by_station)} stations from {csv_path.name}.")


def run_replay(station_id: str) -> bool:
    result = subprocess.run(
        [sys.executable, "scripts/offline_replay.py", "--station", station_id, "--limit", "48"],
        capture_output=True, text=True,
    )
    print(result.stdout)
    if result.returncode != 0:
        print(f"Replay FAILED for {station_id}:\n{result.stderr}")
        return False
    return True


def validate_backup_restore():
    src = db_path()
    original_hash = file_hash(src)
    backup_path = backup_database()
    # Restore
    restore_database(backup_path)
    restored_hash = file_hash(src)
    if original_hash != restored_hash:
        print("ERROR: Backup/restore integrity check FAILED (hash mismatch).")
        sys.exit(1)
    print("Backup/restore integrity check PASSED.")
    # Clean up backup
    backup_path.unlink(missing_ok=True)


def main():
    init_db()
    csv_file = Path("test_weather.csv")
    if not csv_file.is_file():
        raise FileNotFoundError(f"Test data CSV not found: {csv_file}")

    # 1. Seed stations
    seed_demo_stations()

    # 2. Load deterministic telemetry
    load_telemetry_from_csv(csv_file)

    # 3. Pick a sample station and replay
    with csv_file.open(newline="") as f:
        first_row = next(csv.DictReader(f), {})
    sample_station = (first_row.get("station_id") or "AWS-01").strip().upper()
    print(f"Running initial replay for station {sample_station}")
    if not run_replay(sample_station):
        sys.exit(1)

    # 4. Backup & validate restore
    validate_backup_restore()

    # 5. Rehearsals
    for i in range(1, 4):
        print(f"Rehearsal {i}/3 for station {sample_station}")
        if not run_replay(sample_station):
            sys.exit(1)

    print("Demo checklist completed successfully.")


if __name__ == "__main__":
    main()
