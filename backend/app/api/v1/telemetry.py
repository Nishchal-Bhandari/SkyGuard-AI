import io
import csv
import json
import datetime
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, status, Body, BackgroundTasks, Request, Header
from typing import Optional, Dict, Any, List

from backend.app.storage.database import (
    get_latest_assessment,
    get_station_telemetry_stats,
    insert_telemetry_batch,
    list_assessments,
    calibrate_station_qc,
)
from backend.app.storage.database import get_db
from backend.app.api.v1.auth import get_current_user, require_station_access
from backend.app.auth.security import verify_password
from backend.app.services.weather_service import weather_service

import logging
logger = logging.getLogger("skyguard.telemetry")

# Simple in-memory rate limiter for ingestion endpoints
INGEST_RATE_LIMIT: dict[str, list[float]] = {}
RATE_LIMIT_MAX = 100  # max requests per window
RATE_LIMIT_WINDOW = 60  # seconds

def enforce_rate_limit(request: Request):
    """Raise HTTPException if the client exceeds the allowed request rate."""
    key = request.client.host if request.client else "unknown"
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    timestamps = INGEST_RATE_LIMIT.get(key, [])
    # Discard timestamps older than the window
    timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(timestamps) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded for ingestion endpoint.")
    timestamps.append(now)
    INGEST_RATE_LIMIT[key] = timestamps

def log_ingest_audit(station_id: str, device_id: Optional[str], user: Dict[str, Any], client_ip: str, success: bool, detail: str):
    """Record an audit entry for each ESP32 ingest request."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO ingest_audit (station_id, device_id, user_sub, user_role, client_ip, success, detail)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (station_id, device_id, user.get("sub"), user.get("role"), client_ip, int(success), detail)
        )

router = APIRouter(tags=["Telemetry Ingestion & Stats"])


# =============================================================================
# ESP32 Edge-Node Ingestion & Health Endpoints
# =============================================================================

@router.get("/telemetry/esp32/health")
def esp32_health():
    """
    Lightweight health-check for the ESP32 edge node.
    The sensor_simulator.html and ESP32 firmware can ping this to confirm
    the backend is reachable before streaming telemetry.
    """
    return {
        "status": "ONLINE",
        "service": "SkyGuard-AI ESP32 Telemetry Ingest",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "ingest_endpoint": "/api/v1/telemetry/esp32/ingest",
    }


@router.get("/telemetry/esp32/latest")
def get_esp32_latest_telemetry(station_id: str = "AWS-01", current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Returns the latest real-time frame and cross-tier verification
    for the ESP32 Live Monitor UI.
    """
    st_id = str(station_id).strip().upper()
    require_station_access(st_id, current_user)
    latest = weather_service.esp32_latest.get(st_id)
    if not latest:
        # Fallback to current live_state if available
        latest = weather_service.live_state.get(st_id)

    return {
        "success": True,
        "station_id": st_id,
        "has_data": latest is not None and latest.get("esp32_live", False),
        "station": latest,
        "history": weather_service.esp32_history.get(st_id, [])
    }


@router.post("/telemetry/esp32/ingest")
async def ingest_esp32_telemetry(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    authorization: Optional[str] = Header(None),
    x_station_key: Optional[str] = Header(None),
    rate_limit: None = Depends(enforce_rate_limit)
):
    """
    Receives a real-time telemetry frame dispatched by the ESP32 edge node.

    Expected JSON body (produced by skyguard_esp32.ino / serializeEdgeResultJSON):
    {
        "seq": 42,
        "device_id": "esp32-aws01-edge",
        "station_id": "AWS-01",
        "sensors": {
            "temperature": {"value": 24.5, "unit": "°C", "wmo_flag": 0},
            "humidity":    {"value": 65.0,  "unit": "%",  "wmo_flag": 0},
            "pressure":    {"value": 1013.2,"unit": "hPa","wmo_flag": 0},
            "battery_v":   {"value": 12.60, "unit": "V"}
        },
        "derived": {
            "dew_point": 17.84,
            "vapor_pressure_deficit": 8.32,
            "clausius_clapeyron_pass": true
        },
        "edge_ai": {
            "classification": "NOMINAL",
            "anomaly_score": 0.02,
            "reason": "All sensors nominal; thermodynamic checks passed."
        }
    }

    The backend runs the full Tier-2 Cloud ML pipeline on the received data and
    immediately updates the live fleet state for the dashboard.
    Returns a cross-tier verification result (Edge AI vs Cloud ML).
    """
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty payload. Expected ESP32 telemetry JSON."
        )

    station_id = str(payload.get("station_id", "")).strip().upper()
    if not station_id:
        raise HTTPException(status_code=422, detail="STATION_ID_REQUIRED")
    if authorization:
        current_user = get_current_user(authorization)
    elif x_station_key:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT station_id, status, device_key_hash FROM stations WHERE station_id = ?", (station_id,))
            device_station = cur.fetchone()
        if not device_station or device_station.get("status") != "ACTIVE":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid station device credentials")
        key_hash = device_station.get("device_key_hash")
        if not key_hash or not verify_password(x_station_key, key_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid station device credentials")
        current_user = {"sub": f"device:{station_id}", "role": "station_device", "station_id": station_id}
    else:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token or station device key required")

    if current_user.get("role") in {"station_operator", "station_device"}:
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if user_station != station_id:
            log_ingest_audit(
                station_id, payload.get("device_id"), current_user,
                request.client.host if request.client else "unknown", False,
                "Station identity mismatch",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: token station '{user_station}' does not match payload station '{station_id}'."
            )
    logger.info(f"[ESP32 INGEST] Received frame from station={station_id} device={payload.get('device_id')} seq={payload.get('seq')}")

    try:
        result = weather_service.process_esp32_frame(payload)
        if not result.get("acknowledged", result.get("success", False)):
            raise HTTPException(status_code=409, detail=result.get("status", "NOT_ACKNOWLEDGED"))
        # Log successful ingest
        log_ingest_audit(station_id, payload.get("device_id"), current_user, request.client.host if request.client else "unknown", True, "Ingest successful")
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ESP32 INGEST ERROR] {station_id}: {e}", exc_info=True)
        # Log failure
        log_ingest_audit(station_id, payload.get("device_id"), current_user, request.client.host if request.client else "unknown", False, str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ESP32 frame processing failed: {str(e)}"
        )





@router.get("/stations/fleet/live")
def get_fleet_live_state(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns the real-time live evaluated state of the entire fleet.
    Central admin gets all stations.
    Station operator gets only their station.
    """
    try:
        role = current_user.get("role")
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
    from backend.app.services.observation_pipeline import timestamp
    return timestamp(val)


@router.post("/stations/{station_id}/telemetry/upload")
async def upload_station_telemetry(
    station_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
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

    require_station_access(clean_target_id, current_user)
    if request.headers.get("content-type", "").startswith("application/json"):
        payload = await request.json()
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
                raw_ts = row.get(header_map.get("timestamp", header_map.get("time", header_map.get("date", header_map.get("valid_time_utc", header_map.get("valid_time", ""))))))
                if not raw_ts:
                    rejected_rows.append({"line": line_idx, "reason": "Missing timestamp column"})
                    continue
                try:
                    parsed_ts = parse_iso_or_datetime(raw_ts)
                except ValueError as e:
                    rejected_rows.append({"line": line_idx, "reason": str(e)})
                    continue

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
                    temp_val = row.get(header_map.get("temperature_c", header_map.get("temp", header_map.get("temperature", header_map.get("t2m_deg_c", header_map.get("t2m", ""))))))
                    hum_val = row.get(header_map.get("humidity_pct", header_map.get("hum", header_map.get("humidity", header_map.get("relative_humidity_pct", "")))))
                    pres_val = row.get(header_map.get("pressure_hpa", header_map.get("pres", header_map.get("pressure", header_map.get("msl_hpa", header_map.get("msl", ""))))))
                    wind_val = row.get(header_map.get("wind_speed_kmh", header_map.get("wind", header_map.get("wind_speed", ""))))
                    rain_val = row.get(header_map.get("rainfall_mm", header_map.get("rain", header_map.get("rainfall", header_map.get("tp_mm", header_map.get("tp", ""))))))

                    # Process Temperature (convert from Kelvin if t2m is used and > 100)
                    temp = None
                    if temp_val not in (None, "", "null"):
                        val = float(temp_val)
                        if header_map.get("t2m") and val > 100.0:
                            val = val - 273.15
                        temp = val

                    # Process Relative Humidity (compute Magnus-Tetens from d2m and t2m if needed)
                    hum = None
                    if hum_val not in (None, "", "null"):
                        hum = float(hum_val)
                    else:
                        d2m_val = row.get(header_map.get("d2m"))
                        t2m_val = row.get(header_map.get("t2m"))
                        if d2m_val not in (None, "", "null") and t2m_val not in (None, "", "null"):
                            try:
                                d2m_k = float(d2m_val)
                                t2m_k = float(t2m_val)
                                tc = t2m_k - 273.15
                                tdc = d2m_k - 273.15
                                es_tc = 6.11 * (10 ** ((7.5 * tc) / (237.3 + tc)))
                                es_tdc = 6.11 * (10 ** ((7.5 * tdc) / (237.3 + tdc)))
                                hum = min(100.0, max(0.0, (es_tdc / es_tc) * 100.0))
                            except Exception:
                                pass

                    # Process Pressure (convert from Pa to hPa if msl is used and > 50000)
                    pres = None
                    if pres_val not in (None, "", "null"):
                        val = float(pres_val)
                        if header_map.get("msl") and val > 50000.0:
                            val = val / 100.0
                        pres = val

                    wind = float(wind_val) if wind_val not in (None, "", "null") else 10.0

                    # Process Precipitation (convert from meters to mm if tp is used)
                    rain = 0.0
                    if rain_val not in (None, "", "null"):
                        val = float(rain_val)
                        if header_map.get("tp"):
                            val = val * 1000.0
                        rain = val

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

    from backend.app.services.observation_pipeline import observation_pipeline
    result = observation_pipeline.batch(clean_target_id, parsed_rows)
    return {
        **result, "success": result["accepted"] + result["duplicates"] > 0,
        "station_id": clean_target_id, "rows_queued": len(parsed_rows),
        "total_records": get_station_telemetry_stats(clean_target_id).get("total_records", 0),
        "rows_rejected": len(rejected_rows) + result["rejected"],
        "validation_warnings": warnings[:15], "rejection_sample": rejected_rows[:5],
    }


@router.post("/stations/{station_id}/telemetry/batch")
def ingest_batch(station_id: str, payload: List[Dict[str, Any]], current_user: Dict[str, Any] = Depends(get_current_user)):
    from backend.app.services.observation_pipeline import observation_pipeline
    sid = station_id.strip().upper()
    require_station_access(sid, current_user)
    try:
        return observation_pipeline.batch(sid, payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/stations/{station_id}/telemetry/stats")
def get_station_telemetry_statistics(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns high-level telemetry metadata for station_id from Cloud PostgreSQL.
    """
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    stats = get_station_telemetry_stats(clean_id)
    return {
        "success": True,
        **stats
    }


@router.get("/stations/{station_id}/assessments/latest")
def get_latest_station_assessment(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Return the latest persisted server-generated assessment and evidence."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    assessment = get_latest_assessment(clean_id)
    return {
        "success": True,
        "station_id": clean_id,
        "has_assessment": assessment is not None,
        "assessment": assessment,
    }


@router.get("/stations/{station_id}/assessments")
def get_station_assessment_history(
    station_id: str,
    limit: int = 100,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Return a bounded newest-first history of persisted assessments."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    assessments = list_assessments(clean_id, limit)
    return {
        "success": True,
        "station_id": clean_id,
        "assessments": assessments,
    }
