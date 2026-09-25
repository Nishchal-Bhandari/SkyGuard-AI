import datetime
from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

from backend.app.storage.database import (
    list_incidents,
    get_incident,
    adjudicate_incident,
    clear_all_incidents
)
from backend.app.api.v1.auth import get_current_user, require_admin

router = APIRouter(tags=["Incident Triage & Adjudication"])


class AdjudicatePayload(BaseModel):
    action: str = Field(..., description="Action to take: ACKNOWLEDGE, GENUINE, REJECT, or ACCEPT")


@router.get("/incidents")
def get_incidents(
    station_id: Optional[str] = Query(None, description="Optional station ID filter"),
    status: Optional[str] = Query(None, description="Optional incident status: open, acknowledged, resolved"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns the queue of anomaly incidents.
    - Station Operators receive only incidents for their assigned station.
    - Central Admins receive incidents across the entire fleet.
    """
    filter_station = station_id
    if current_user.get("role") == "station_operator":
        filter_station = str(current_user.get("station_id", "")).strip().upper()

    incidents = list_incidents(station_id=filter_station, status=status)
    return {
        "success": True,
        "count": len(incidents),
        "incidents": incidents,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }


@router.get("/incidents/{incident_id}")
def get_incident_by_id(
    incident_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Retrieves a single incident by ID with full evidence graph and reason codes.
    """
    clean_id = incident_id.strip()
    incident = get_incident(clean_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident '{clean_id}' not found")

    if current_user.get("role") == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if incident["station_id"] != user_station:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: cannot view incident for '{incident['station_id']}'"
            )

    return {"success": True, "incident": incident}


@router.post("/incidents/{incident_id}/adjudicate")
def adjudicate(
    incident_id: str,
    payload: AdjudicatePayload,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Adjudicates an anomaly incident (ACKNOWLEDGE, GENUINE, REJECT, ACCEPT).
    Enforces station-operator identity boundary.
    """
    clean_id = incident_id.strip()
    existing = get_incident(clean_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Incident '{clean_id}' not found")

    role = current_user.get("role")
    if role == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if existing["station_id"] != user_station:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: cannot adjudicate incident for station '{existing['station_id']}'"
            )

    operator_name = current_user.get("name") or current_user.get("username") or "Operator"
    updated = adjudicate_incident(clean_id, payload.action, operator_name=operator_name)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update incident disposition")

    return {
        "success": True,
        "message": f"Incident {clean_id} adjudicated as {payload.action}",
        "incident": updated
    }


@router.delete("/incidents")
def delete_all_incidents(
    station_id: Optional[str] = Query(None, description="Optional: restrict deletion to a single station"),
    current_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Permanently deletes incidents from the database. Restricted to Central Admin.
    When station_id is provided, only that station's incidents are removed.
    """
    scope = station_id.strip().upper() if station_id else None
    count = clear_all_incidents(station_id=scope)
    return {
        "success": True,
        "message": f"Incident queue cleared for station '{scope}'" if scope else "Global incident queue cleared successfully",
        "station_id": scope,
        "cleared_count": count
    }
