from fastapi import APIRouter, HTTPException, Depends, status, Body, BackgroundTasks
from typing import Optional, Dict, Any, List

from backend.app.storage.database import (
    set_active_fault,
    clear_active_fault,
    get_active_fault
)
from backend.app.api.v1.auth import get_current_user
from backend.app.services.weather_service import weather_service

router = APIRouter(tags=["Fault Injection"])


@router.post("/stations/{station_id}/faults/inject")
def inject_fault(
    station_id: str,
    background_tasks: BackgroundTasks,
    payload: Dict[str, Any] = Body(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Injects a synthetic fault for the specified station.
    """
    clean_id = station_id.strip().upper()
    
    # RBAC Enforcement
    role = current_user.get("role")
    if role == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if user_station != clean_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: Authenticated as '{user_station}', cannot inject fault on '{clean_id}'."
            )
            
    fault_type = payload.get("fault_type")
    offset_val = payload.get("offset_val")
    
    if not fault_type:
        raise HTTPException(status_code=400, detail="fault_type is required")
        
    set_active_fault(clean_id, fault_type, offset_val)
    weather_service.reevaluate()
    
    return {
        "success": True,
        "station_id": clean_id,
        "fault_type": fault_type,
        "message": f"Successfully injected {fault_type} on {clean_id}"
    }


@router.post("/stations/{station_id}/faults/reset")
def reset_fault(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Resets/clears any active fault for the specified station.
    """
    clean_id = station_id.strip().upper()
    
    # RBAC Enforcement
    role = current_user.get("role")
    if role == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if user_station != clean_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: Authenticated as '{user_station}', cannot reset fault on '{clean_id}'."
            )
            
    clear_active_fault(clean_id)
    weather_service.reevaluate()
    
    return {
        "success": True,
        "station_id": clean_id,
        "message": f"Successfully reset faults on {clean_id}"
    }


@router.get("/stations/{station_id}/faults")
def get_fault_status(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns the current active fault for the station, if any.
    """
    clean_id = station_id.strip().upper()
    fault = get_active_fault(clean_id)
    
    return {
        "success": True,
        "station_id": clean_id,
        "has_fault": fault is not None,
        "fault": fault
    }
