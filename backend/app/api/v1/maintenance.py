from fastapi import APIRouter, HTTPException, Depends, Body, status
from typing import Dict, Any

from backend.app.storage.database import (
    get_station_maintenance_tasks,
    set_maintenance_task_state,
    sign_maintenance_audit,
    list_maintenance_audit,
)
from backend.app.api.v1.auth import get_current_user, require_station_access

router = APIRouter(tags=["Field Maintenance & Sensor Calibration"])


@router.get("/stations/{station_id}/maintenance/tasks")
def get_maintenance_tasks(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Returns the persisted field maintenance & sensor calibration checklist for a station."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    tasks = get_station_maintenance_tasks(clean_id)
    return {"success": True, "station_id": clean_id, "tasks": tasks}


@router.patch("/stations/{station_id}/maintenance/tasks/{task_key}")
def update_maintenance_task(
    station_id: str,
    task_key: str,
    payload: Dict[str, Any] = Body(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Persists a single checklist item's completion state (survives reload/reload-elsewhere)."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    done = bool(payload.get("done", False))
    actor = current_user.get("name") or current_user.get("username") or "Operator"
    try:
        tasks = set_maintenance_task_state(clean_id, task_key.strip(), done, actor)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    return {"success": True, "station_id": clean_id, "tasks": tasks}


@router.post("/stations/{station_id}/maintenance/submit")
def submit_maintenance_audit(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Signs the current checklist snapshot into an immutable, hash-verifiable audit record."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    actor = current_user.get("name") or current_user.get("username") or "Operator"
    record = sign_maintenance_audit(clean_id, actor)
    return {"success": True, "station_id": clean_id, "audit": record}


@router.get("/stations/{station_id}/maintenance/history")
def get_maintenance_history(
    station_id: str,
    limit: int = 50,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Returns the newest-first signed maintenance audit log for a station."""
    clean_id = station_id.strip().upper()
    require_station_access(clean_id, current_user)
    history = list_maintenance_audit(clean_id, limit)
    return {"success": True, "station_id": clean_id, "history": history}
