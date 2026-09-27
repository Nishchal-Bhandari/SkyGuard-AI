#!/usr/bin/env python3
"""Offline replay of stored telemetry for a station.
Usage: python offline_replay.py --station AWS-01 [--start "2026-08-01"] [--end "2026-08-02"]
The script fetches historical telemetry rows and re‑processes each via the
weather_service pipeline, converting stored DB rows into the ESP32 ingest payload shape.
Exits nonzero if any row fails processing.
"""
import argparse
import datetime
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.storage.database import fetch_historical_telemetry
from backend.app.services.weather_service import weather_service


def parse_args():
    parser = argparse.ArgumentParser(description="Replay stored telemetry for a station.")
    parser.add_argument("--station", required=True, help="Station ID (e.g., AWS-01)")
    parser.add_argument("--start", help="ISO start timestamp (inclusive)")
    parser.add_argument("--end", help="ISO end timestamp (inclusive)")
    parser.add_argument("--limit", type=int, help="Replay at most this many chronological rows")
    return parser.parse_args()


def iso_to_dt(ts: str) -> datetime.datetime:
    try:
        return datetime.datetime.fromisoformat(str(ts))
    except Exception:
        return datetime.datetime.min


def row_to_esp32_payload(station_id: str, row: dict) -> dict:
    """Convert a stored telemetry row into the ESP32 ingest payload shape."""
    return {
        "seq": 0,
        "device_id": f"replay-{station_id}",
        "station_id": station_id,
        "timestamp": row.get("timestamp"),
        "sensors": {
            "temperature": {"value": float(row.get("temp", 0)), "unit": "°C", "wmo_flag": 0},
            "humidity": {"value": float(row.get("hum", 0)), "unit": "%", "wmo_flag": 0},
            "pressure": {"value": float(row.get("pres", 1010.0)), "unit": "hPa", "wmo_flag": 0},
            "battery_v": {"value": float(row.get("battery", 12.6)), "unit": "V"},
        },
        "derived": {},
        "edge_ai": {},
    }


def main():
    args = parse_args()
    station = args.station.strip().upper()
    rows = fetch_historical_telemetry(station)
    if not rows:
        print(f"No telemetry rows found for {station}")
        sys.exit(1)
    # Optional time filtering
    if args.start:
        start_dt = iso_to_dt(args.start)
        rows = [r for r in rows if iso_to_dt(r.get("timestamp", "")) >= start_dt]
    if args.end:
        end_dt = iso_to_dt(args.end)
        rows = [r for r in rows if iso_to_dt(r.get("timestamp", "")) <= end_dt]
    if args.limit is not None:
        if args.limit <= 0:
            print("--limit must be a positive integer")
            sys.exit(2)
        rows = rows[:args.limit]
    if not rows:
        print(f"No telemetry rows match the replay filters for {station}")
        sys.exit(1)

    print(f"Replaying {len(rows)} rows for station {station}...")
    failures = 0
    for row in rows:
        try:
            payload = row_to_esp32_payload(station, row)
            result = weather_service.process_esp32_frame(payload)
            print(f"[{row.get('timestamp')}] Processed - status: {result.get('status', 'OK')}")
        except Exception as e:
            print(f"[{row.get('timestamp')}] Processing error: {e}")
            failures += 1

    if failures > 0:
        print(f"\n{failures}/{len(rows)} rows failed during replay.")
        sys.exit(1)
    else:
        print(f"\nAll {len(rows)} rows replayed successfully.")


if __name__ == "__main__":
    main()
