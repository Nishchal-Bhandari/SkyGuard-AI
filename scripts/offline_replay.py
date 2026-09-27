#!/usr/bin/env python3
"""Offline replay of stored telemetry for a station.
Usage: python offline_replay.py --station AWS-01 [--start "2026-08-01"] [--end "2026-08-02"]
The script fetches historical telemetry rows and re‑processes each via the
weather_service pipeline, emulating the real‑time ingest flow.
"""
import argparse
import json
import datetime
from backend.app.storage.database import fetch_historical_telemetry, get_db
from backend.app.services import weather_service

def parse_args():
    parser = argparse.ArgumentParser(description="Replay stored telemetry for a station.")
    parser.add_argument("--station", required=True, help="Station ID (e.g., AWS-01)")
    parser.add_argument("--start", help="ISO start timestamp (inclusive)")
    parser.add_argument("--end", help="ISO end timestamp (inclusive)")
    return parser.parse_args()

def iso_to_dt(ts: str) -> datetime.datetime:
    try:
        return datetime.datetime.fromisoformat(ts)
    except Exception:
        return datetime.datetime.min

def main():
    args = parse_args()
    station = args.station.strip().upper()
    rows = fetch_historical_telemetry(station)
    if not rows:
        print(f"No telemetry rows found for {station}")
        return
    # Optional time filtering
    if args.start:
        start_dt = iso_to_dt(args.start)
        rows = [r for r in rows if iso_to_dt(r.get("timestamp", "")) >= start_dt]
    if args.end:
        end_dt = iso_to_dt(args.end)
        rows = [r for r in rows if iso_to_dt(r.get("timestamp", "")) <= end_dt]

    print(f"Replaying {len(rows)} rows for station {station}...")
    for row in rows:
        try:
            # The processing function expects the same payload structure as the ESP32 ingest.
            result = weather_service.process_esp32_frame(row)
            print(f"[{row.get('timestamp')}] Processed – status: {result.get('status', 'OK')}")
        except Exception as e:
            print(f"[{row.get('timestamp')}] Processing error: {e}")

if __name__ == "__main__":
    main()
