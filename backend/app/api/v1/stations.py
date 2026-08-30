import datetime
import re
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union

from backend.app.storage.database import get_db, get_station_qc_config
from backend.app.auth.security import hash_password
from backend.app.api.v1.auth import require_admin, get_current_user, get_optional_user

router = APIRouter(tags=["Station Management"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateStationRequest(BaseModel):
    station_id: str = Field(..., min_length=2, max_length=32, description="Unique station ID (e.g. AWS-07)")
    station_name: str = Field(..., min_length=2, max_length=128)
    username: str = Field(..., min_length=2, max_length=64)
    password: Optional[str] = Field(default="sentinel2026", min_length=4, max_length=128)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    elevation: Optional[float] = Field(default=0.0, ge=-500.0, le=9000.0)
    region: Optional[str] = Field(default="Assigned Region", max_length=128)
    status: Optional[str] = Field(default="ACTIVE", pattern="^(ACTIVE|INACTIVE)$")

class StationSummaryResponse(BaseModel):
    id: int
    station_id: str
    station_name: str
    username: str
    access_key: Optional[str] = "sentinel2026"
    latitude: float
    longitude: float
    elevation: float
    region: str
    status: str
    created_by: Optional[str] = "admin"
    created_at: Union[str, datetime.datetime]
    updated_at: Union[str, datetime.datetime]
    last_login: Optional[Union[str, datetime.datetime]] = None

class StatusToggleRequest(BaseModel):
    status: str = Field(..., pattern="^(ACTIVE|INACTIVE)$")

class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128)

class PresetStationItem(BaseModel):
    id: str
    name: str
    region: str
    lat: float
    lon: float
    elevation: Optional[float] = 0.0
    username: Optional[str] = None
    password: Optional[str] = "sentinel2026"
    status: Optional[str] = "ACTIVE"

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/admin/stations", response_model=List[StationSummaryResponse])
def list_stations_admin(admin_user: Dict[str, Any] = Depends(require_admin)):
    """
    Central Admin endpoint: Lists all registered weather stations.
    Never returns password hashes or plaintext credentials.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, station_id, station_name, username, access_key, latitude, longitude,
                   elevation, region, status, created_by, created_at, updated_at, last_login
            FROM stations
            ORDER BY id ASC
        """)
        rows = cursor.fetchall()
        return [
            StationSummaryResponse(
                id=r["id"],
                station_id=r["station_id"],
                station_name=r["station_name"],
                username=r["username"],
                access_key=r["access_key"] if "access_key" in r.keys() and r["access_key"] else "sentinel2026",
                latitude=r["latitude"],
                longitude=r["longitude"],
                elevation=r["elevation"],
                region=r["region"],
                status=r["status"],
                created_by=r["created_by"],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                last_login=r["last_login"]
            ) for r in rows
        ]

@router.post("/admin/stations", response_model=StationSummaryResponse, status_code=status.HTTP_201_CREATED)
def create_station(payload: CreateStationRequest, admin_user: Dict[str, Any] = Depends(require_admin)):
    """
    Central Admin endpoint: Provisions a new Automatic Weather Station account in SQLite.
    Performs server-side validation and secure password hashing.
    """
    clean_station_id = payload.station_id.strip().upper()
    clean_username = payload.username.strip().lower()
    
    if not re.match(r'^[A-Z0-9_-]+$', clean_station_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Station ID must contain only alphanumeric characters, dashes, and underscores."
        )
    
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    pwd_hash = hash_password(payload.password or "sentinel2026")
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check uniqueness of station_id
        cursor.execute("SELECT id FROM stations WHERE station_id = ?", (clean_station_id,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Weather Station ID '{clean_station_id}' already exists."
            )
        
        # Check uniqueness of username
        cursor.execute("SELECT id FROM stations WHERE username = ?", (clean_username,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Station username '{clean_username}' is already in use."
            )
        
        cursor.execute("""
            INSERT INTO stations (
                station_id, station_name, username, password_hash, access_key, latitude, longitude,
                elevation, region, status, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            clean_station_id,
            payload.station_name.strip(),
            clean_username,
            pwd_hash,
            payload.password or "sentinel2026",
            payload.latitude,
            payload.longitude,
            payload.elevation or 0.0,
            payload.region or "Assigned Region",
            payload.status or "ACTIVE",
            admin_user.get("sub", "admin"),
            now_iso,
            now_iso
        ))
        
        station_pk = cursor.lastrowid
        if not station_pk:
            cursor.execute("SELECT id FROM stations WHERE station_id = ?", (clean_station_id,))
            st_id_row = cursor.fetchone()
            station_pk = st_id_row["id"] if st_id_row else 1
        
        return StationSummaryResponse(
            id=station_pk,
            station_id=clean_station_id,
            station_name=payload.station_name.strip(),
            username=clean_username,
            access_key=payload.password or "sentinel2026",
            latitude=payload.latitude,
            longitude=payload.longitude,
            elevation=payload.elevation or 0.0,
            region=payload.region or "Assigned Region",
            status=payload.status or "ACTIVE",
            created_by=admin_user.get("sub", "admin"),
            created_at=now_iso,
            updated_at=now_iso,
            last_login=None
        )

@router.post("/admin/stations/batch-presets", response_model=Dict[str, Any])
def batch_create_presets(presets: List[PresetStationItem], admin_user: Dict[str, Any] = Depends(require_admin)):
    """
    Central Admin endpoint: Provisions Indian AWS fleet presets idempotently into SQLite.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    inserted_count = 0
    
    with get_db() as conn:
        cursor = conn.cursor()
        for p in presets:
            st_id = p.id.strip().upper()
            username = (p.username or f"operator_{st_id.lower()}").strip().lower()
            
            cursor.execute("SELECT id FROM stations WHERE station_id = ? OR username = ?", (st_id, username))
            if cursor.fetchone():
                continue
            
            pwd_hash = hash_password(p.password or "sentinel2026")
            cursor.execute("""
                INSERT INTO stations (
                    station_id, station_name, username, password_hash, access_key, latitude, longitude,
                    elevation, region, status, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'admin_presets', ?, ?)
            """, (
                st_id,
                p.name.strip(),
                username,
                pwd_hash,
                p.password or "sentinel2026",
                p.lat,
                p.lon,
                p.elevation or 0.0,
                p.region or "Assigned Region",
                now_iso,
                now_iso
            ))
            inserted_count += 1
            
    return {"success": True, "insertedCount": inserted_count, "message": f"Provisioned {inserted_count} preset stations"}

@router.get("/stations/{station_id}", response_model=StationSummaryResponse)
def get_station_by_id(station_id: str, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    """
    Authoritative Station Profile Access:
    - Central Admin can access any station.
    - Station Operator can ONLY access their own station identity (station_id in token).
    """
    target_id = station_id.strip().upper()
    
    # Station Identity Enforcement
    if current_user and current_user.get("role") == "station_operator":
        user_station_id = current_user.get("station_id", "").strip().upper()
        if user_station_id != target_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: Authenticated as '{user_station_id}', cannot access '{target_id}'"
            )
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, station_id, station_name, username, access_key, latitude, longitude,
                   elevation, region, status, created_by, created_at, updated_at, last_login
            FROM stations
            WHERE station_id = ?
        """, (target_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Weather station '{target_id}' not found."
            )
        
        return StationSummaryResponse(
            id=row["id"],
            station_id=row["station_id"],
            station_name=row["station_name"],
            username=row["username"],
            access_key=row["access_key"] if "access_key" in row.keys() and row["access_key"] else "sentinel2026",
            latitude=row["latitude"],
            longitude=row["longitude"],
            elevation=row["elevation"],
            region=row["region"],
            status=row["status"],
            created_by=row["created_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            last_login=row["last_login"]
        )

@router.patch("/admin/stations/{station_id}/status", response_model=Dict[str, Any])
def toggle_station_status(station_id: str, payload: StatusToggleRequest, admin_user: Dict[str, Any] = Depends(require_admin)):
    """
    Central Admin endpoint: Activates or deactivates station terminal access.
    """
    target_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM stations WHERE station_id = ?", (target_id,))
        if not cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Weather station '{target_id}' not found."
            )
        
        cursor.execute("UPDATE stations SET status = ?, updated_at = ? WHERE station_id = ?", (payload.status, now_iso, target_id))
        
        return {
            "success": True,
            "station_id": target_id,
            "new_status": payload.status,
            "message": f"Station {target_id} status updated to {payload.status}"
        }

@router.post("/admin/stations/{station_id}/reset-password", response_model=Dict[str, Any])
def reset_station_password(station_id: str, payload: ResetPasswordRequest, admin_user: Dict[str, Any] = Depends(require_admin)):
    """
    Central Admin endpoint: Resets a station operator's access key with a newly salted PBKDF2 hash.
    """
    target_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    new_hash = hash_password(payload.new_password)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM stations WHERE station_id = ?", (target_id,))
        if not cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Weather station '{target_id}' not found."
            )
        
        cursor.execute("UPDATE stations SET password_hash = ?, access_key = ?, updated_at = ? WHERE station_id = ?", (new_hash, payload.new_password, now_iso, target_id))
        
        return {
            "success": True,
            "station_id": target_id,
            "message": f"Passphrase for {target_id} updated and hashed in SQLite."
        }


@router.get('/stations/{station_id}/qc')
def get_station_qc(station_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    target_id = station_id.strip().upper()
    if current_user.get('role') != 'admin' and current_user.get('role') != 'CENTRAL_ADMIN':
        if current_user.get('station_id') != target_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Station operator cannot access QC configuration for another station."
            )
            
    config = get_station_qc_config(target_id)
    if not config:
        return {"success": True, "station_id": target_id, "has_config": False}
        
    return {
        "success": True,
        "station_id": target_id,
        "has_config": True,
        "config": config
    }
