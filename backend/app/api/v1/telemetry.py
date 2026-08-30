import io
import csv
import json
import datetime
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, status, Body, BackgroundTasks
from typing import Optional, Dict, Any, List

from backend.app.storage.database import insert_telemetry_batch, get_station_telemetry_stats, calibrate_station_qc
from backend.app.api.v1.auth import get_current_user, get_optional_user
from backend.app.services.weather_service import weather_service

import logging
logger = logging.getLogger("skyguard.telemetry")

router = APIRouter(tags=["Telemetry Ingestion & Stats"])


@router.get("/stations/fleet/live")
def get_fleet_live_state(
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """
    Returns the real-time live evaluated state of the entire fleet.
    Central admin gets all stations.
    Station operator gets only their station.
    """
    try:
        role = current_user.get("role") if current_user else None
        fleet_state = weather_service.get_fleet_state() or []
        
        if role == "station_operator":
            user_station = str(current_user.get("station_id", "")).strip().upper()
            fleet_state = [s for s in fleet_state if str(s.get("station_id", "")).strip().upper() == user_station]
            
        return {
            "success": True,
            "stations": fleet_state,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"[FLEET LIVE ERROR] Error in get_fleet_live_state: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Fleet state evaluation error: {str(e)}"
        )


def parse_iso_or_datetime(val: str) -> str:
    """Attempts to parse varied timestamp string formats into UTC ISO-8601 string."""
    clean_val = str(val).strip().replace("/", "-")
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y-%m-%d"
    ):
        try:
            dt = datetime.datetime.strptime(clean_val, fmt)
            return dt.replace(tzinfo=datetime.timezone.utc).isoformat()
        except ValueError:
            continue
    # Fallback to direct ISO if valid or now
    try:
        return datetime.datetime.fromisoformat(clean_val).isoformat()
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()


@router.post("/stations/{station_id}/telemetry/upload")
async def upload_station_telemetry(
    station_id: str,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    payload: Optional[List[Dict[str, Any]]] = Body(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Ingests and validates historical weather station telemetry into Cloud PostgreSQL.
    Strictly verifies that uploaded records belong to the target station_id.
    Enforces RBAC:
      - Central Admin can upload for any station.
      - Station Operator can ONLY upload for their assigned station.
    """
    clean_target_id = station_id.strip().upper()

    # RBAC Enforcement
    role = current_user.get("role")
    if role == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if user_station != clean_target_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: Authenticated as '{user_station}', cannot upload telemetry for '{clean_target_id}'."
            )

    parsed_rows = []
    rejected_rows = []
    warnings = []

    # Handle CSV / File upload
    if file:
        filename = file.filename or ""
        if not (filename.endswith(".csv") or filename.endswith(".json") or filename.endswith(".txt")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type '{filename}'. Only CSV or JSON telemetry logs are accepted."
            )

        content = await file.read()
        text_data = content.decode("utf-8", errors="replace")

        if filename.endswith(".json"):
            try:
                json_data = json.loads(text_data)
                raw_list = json_data if isinstance(json_data, list) else json_data.get("data", [json_data])
                for idx, item in enumerate(raw_list):
                    # Station ID cross-check
                    st_col = item.get("station_id", item.get("station", clean_target_id))
                    if st_col and str(st_col).strip().upper() != clean_target_id:
                        rejected_rows.append({"index": idx, "reason": f"Row station_id '{st_col}' does not match target '{clean_target_id}'"})
                        continue
                    parsed_rows.append(item)
            except Exception as e:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON file: {e}")
        else:
            # CSV Parsing
            reader = csv.DictReader(io.StringIO(text_data))
            if not reader.fieldnames:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty or missing header line.")

            # Normalize header map
            header_map = {name.strip().lower(): name for name in reader.fieldnames}
            
            # Detect if this is gridded spatial data (has lat/lon columns)
            has_lat_col = "latitude" in header_map or "lat" in header_map
            has_lon_col = "longitude" in header_map or "lon" in header_map

            for line_idx, row in enumerate(reader, start=2):
                # 1. Station ID validation if present in CSV
                row_station = row.get(header_map.get("station_id", header_map.get("station", "")))
                if row_station and str(row_station).strip().upper() != clean_target_id:
                    rejected_rows.append({
                        "line": line_idx,
                        "reason": f"Dataset station '{row_station}' does not match target '{clean_target_id}'"
                    })
                    continue

                # 2. Timestamp extraction — kept as a clean ISO-8601 string
                #    (must remain a valid TIMESTAMPTZ for PostgreSQL)
                raw_ts = row.get(header_map.get("timestamp", header_map.get("time", header_map.get("date", header_map.get("valid_time_utc", "")))))
                if not raw_ts:
                    rejected_rows.append({"line": line_idx, "reason": "Missing timestamp column"})
                    continue
                parsed_ts = parse_iso_or_datetime(raw_ts)

                # For gridded spatial data: store coordinates in a separate grid_point
                # field ("lat,lon") instead of embedding them in the timestamp string.
                # This keeps timestamp a valid TIMESTAMPTZ while still making each
                # grid point unique via the (station_id, timestamp, grid_point) index.
                raw_lat = row.get(header_map.get("latitude", header_map.get("lat", ""))) if has_lat_col else None
                raw_lon = row.get(header_map.get("longitude", header_map.get("lon", ""))) if has_lon_col else None
                grid_point = ""
                if raw_lat and raw_lon:
                    try:
                        grid_point = f"{float(raw_lat):.4f},{float(raw_lon):.4f}"
                    except ValueError:
                        pass

                # 3. Numeric fields
                try:
                    temp_val = row.get(header_map.get("temperature_c", header_map.get("temp", header_map.get("temperature", header_map.get("t2m_deg_c", "")))))
                    hum_val = row.get(header_map.get("humidity_pct", header_map.get("hum", header_map.get("humidity", header_map.get("relative_humidity_pct", "")))))
                    pres_val = row.get(header_map.get("pressure_hpa", header_map.get("pres", header_map.get("pressure", header_map.get("msl_hpa", "")))))
                    wind_val = row.get(header_map.get("wind_speed_kmh", header_map.get("wind", header_map.get("wind_speed", ""))))
                    rain_val = row.get(header_map.get("rainfall_mm", header_map.get("rain", header_map.get("rainfall", header_map.get("tp_mm", "")))))

                    temp = float(temp_val) if temp_val not in (None, "", "null") else None
                    hum = float(hum_val) if hum_val not in (None, "", "null") else None
                    pres = float(pres_val) if pres_val not in (None, "", "null") else None
                    wind = float(wind_val) if wind_val not in (None, "", "null") else 10.0
                    rain = float(rain_val) if rain_val not in (None, "", "null") else 0.0

                    # Range sanity check
                    if temp is not None and (temp < -60.0 or temp > 75.0):
                        warnings.append(f"Line {line_idx}: Extreme temperature ({temp}°C) flagged for review.")

                    grid_payload = {}
                    if raw_lat and raw_lon:
                        try:
                            grid_payload = {"lat": float(raw_lat), "lon": float(raw_lon)}
                        except ValueError:
                            pass

                    parsed_rows.append({
                        "timestamp": parsed_ts,
                        "grid_point": grid_point,
                        "temp": temp,
                        "hum": hum,
                        "pres": pres,
                        "wind": wind,
                        "rain": rain,
                        "battery": 12.6,
                        "signal": -70.0,
                        "qc_flag": "VALID",
                        "raw_payload": grid_payload
                    })
                except ValueError as e:
                    rejected_rows.append({"line": line_idx, "reason": f"Invalid numeric data: {e}"})


    elif payload:
        # Direct JSON Body Upload
        for idx, item in enumerate(payload):
            st_col = item.get("station_id", clean_target_id)
            if st_col and str(st_col).strip().upper() != clean_target_id:
                rejected_rows.append({"index": idx, "reason": f"Station '{st_col}' does not match target '{clean_target_id}'"})
                continue
            parsed_rows.append(item)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No CSV file or JSON telemetry body provided.")

    if not parsed_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Zero valid telemetry rows could be parsed from upload.",
                "rejected_count": len(rejected_rows),
                "rejections": rejected_rows[:10]
            }
        )

    # Ingest into Cloud PostgreSQL in a single safe transaction
    inserted_count, error_count = insert_telemetry_batch(clean_target_id, parsed_rows)
    stats = get_station_telemetry_stats(clean_target_id)

    # Trigger station-specific background QC calibration
    background_tasks.add_task(calibrate_station_qc, clean_target_id)

    return {
        "success": True,
        "station_id": clean_target_id,
        "rows_uploaded": inserted_count,
        "total_records": stats.get("total_records", inserted_count),
        "rows_rejected": len(rejected_rows) + error_count,
        "validation_warnings": warnings[:15],
        "rejection_sample": rejected_rows[:5],
        "message": f"Successfully ingested {inserted_count} telemetry records into Cloud PostgreSQL for {clean_target_id}."
    }


@router.get("/stations/{station_id}/telemetry/stats")
def get_station_telemetry_statistics(
    station_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """
    Returns high-level telemetry metadata for station_id from Cloud PostgreSQL.
    """
    clean_id = station_id.strip().upper()
    stats = get_station_telemetry_stats(clean_id)
    return {
        "success": True,
        **stats
    }
