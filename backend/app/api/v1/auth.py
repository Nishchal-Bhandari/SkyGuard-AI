import datetime
from fastapi import APIRouter, HTTPException, Depends, Header, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from backend.app.storage.database import get_db
from backend.app.auth.security import verify_password, create_access_token, decode_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])

# ---------------------------------------------------------------------------
# Request & Response Contracts
# ---------------------------------------------------------------------------

class AdminLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)

class StationLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64, description="Station username or Station ID")
    password: str = Field(..., min_length=1)

class UserProfile(BaseModel):
    id: int
    username: str
    name: str
    role: str
    assignedStationId: Optional[str] = None
    stationName: Optional[str] = None
    status: str

class LoginResponse(BaseModel):
    success: bool
    token: str
    role: str
    user: UserProfile
    message: str = "Authentication successful"

# ---------------------------------------------------------------------------
# Security Dependencies & RBAC Guards
# ---------------------------------------------------------------------------

def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """
    Validates the Bearer token from the Authorization header and returns the token payload.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = parts[1]
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token expired or invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return payload

def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Guard requiring Central Admin role.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Central Administrator privileges required"
        )
    return current_user

def require_station(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Guard requiring Station Operator role.
    """
    if current_user.get("role") != "station_operator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Station Operator privileges required"
        )
    return current_user

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/admin/login", response_model=LoginResponse)
def login_admin(payload: AdminLoginRequest):
    """
    Authenticates a Central Administrator against the SQLite database.
    """
    clean_username = payload.username.strip().lower()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM admins WHERE username = ?", (clean_username,))
        admin_row = cursor.fetchone()
        
        if not admin_row or not verify_password(payload.password, admin_row["password_hash"]):
            # Audit failed attempt
            cursor.execute("""
                INSERT INTO auth_audit_logs (actor_username, role, event_type, status, details, created_at)
                VALUES (?, 'admin', 'LOGIN_ATTEMPT', 'FAILED', 'Invalid credentials', ?);
            """, (clean_username, now_iso))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Administrator username or password."
            )
        
        if admin_row["status"] != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This Administrator account has been deactivated."
            )
        
        # Update last login
        cursor.execute("UPDATE admins SET last_login = ?, updated_at = ? WHERE id = ?", (now_iso, now_iso, admin_row["id"]))
        
        # Audit successful login
        cursor.execute("""
            INSERT INTO auth_audit_logs (actor_username, role, event_type, status, details, created_at)
            VALUES (?, 'admin', 'LOGIN_SUCCESS', 'SUCCESS', 'Admin authenticated', ?);
        """, (clean_username, now_iso))
        
        token = create_access_token({
            "sub": admin_row["username"],
            "user_id": admin_row["id"],
            "role": "admin",
            "name": admin_row["full_name"]
        })
        
        return LoginResponse(
            success=True,
            token=token,
            role="admin",
            user=UserProfile(
                id=admin_row["id"],
                username=admin_row["username"],
                name=admin_row["full_name"],
                role="admin",
                status=admin_row["status"]
            ),
            message="Central Admin login successful"
        )

@router.post("/station/login", response_model=LoginResponse)
def login_station(payload: StationLoginRequest):
    """
    Authenticates an Automatic Weather Station Operator against the SQLite database.
    Accepts either station username or station_id.
    """
    clean_identifier = payload.username.strip().lower()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stations 
            WHERE username = ? OR station_id = ?
        """, (clean_identifier, clean_identifier.upper()))
        st_row = cursor.fetchone()
        
        if not st_row or not verify_password(payload.password, st_row["password_hash"]):
            cursor.execute("""
                INSERT INTO auth_audit_logs (actor_username, role, event_type, status, details, created_at)
                VALUES (?, 'station_operator', 'LOGIN_ATTEMPT', 'FAILED', 'Invalid credentials', ?);
            """, (clean_identifier, now_iso))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Station Operator username or passphrase."
            )
        
        if st_row["status"] != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access for station {st_row['station_id']} is currently deactivated by Central Admin."
            )
        
        cursor.execute("UPDATE stations SET last_login = ?, updated_at = ? WHERE id = ?", (now_iso, now_iso, st_row["id"]))
        
        cursor.execute("""
            INSERT INTO auth_audit_logs (actor_username, role, event_type, status, details, created_at)
            VALUES (?, 'station_operator', 'LOGIN_SUCCESS', 'SUCCESS', 'Station operator authenticated', ?);
        """, (st_row["username"], now_iso))
        
        token = create_access_token({
            "sub": st_row["username"],
            "user_id": st_row["id"],
            "role": "station_operator",
            "station_id": st_row["station_id"],
            "station_name": st_row["station_name"],
            "name": f"{st_row['station_id']} Operator"
        })
        
        return LoginResponse(
            success=True,
            token=token,
            role="station_operator",
            user=UserProfile(
                id=st_row["id"],
                username=st_row["username"],
                name=f"{st_row['station_id']} Operator",
                role="station_operator",
                assignedStationId=st_row["station_id"],
                stationName=st_row["station_name"],
                status=st_row["status"]
            ),
            message=f"Station {st_row['station_id']} authenticated successfully"
        )

@router.get("/me", response_model=Dict[str, Any])
def get_current_user_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Returns the authenticated user's profile and validates session validity.
    """
    return {
        "authenticated": True,
        "username": current_user.get("sub"),
        "role": current_user.get("role"),
        "name": current_user.get("name"),
        "assignedStationId": current_user.get("station_id"),
        "stationName": current_user.get("station_name")
    }
