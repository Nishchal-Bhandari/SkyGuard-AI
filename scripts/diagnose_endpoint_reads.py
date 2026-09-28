"""Read-only checks for the database-backed screens; prints no secrets or rows."""

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.api.v1.stations import list_stations_admin
from backend.app.services.weather_service import weather_service
from backend.app.storage.database import get_active_model_record, get_db


def main():
    checks = {}
    try:
        checks["admin_stations"] = len(list_stations_admin({"role": "admin"}))
        checks["fleet_live"] = len(weather_service.get_fleet_state())
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS count FROM maintenance_tasks WHERE station_id = ?", ("AWS-01",))
            checks["aws01_maintenance_tasks"] = cursor.fetchone()["count"]
        checks["aws01_active_model"] = bool(get_active_model_record("AWS-01"))
    except Exception as error:
        checks["error_type"] = type(error).__name__
    print(json.dumps(checks, indent=2))
    return 1 if "error_type" in checks else 0


if __name__ == "__main__":
    raise SystemExit(main())
