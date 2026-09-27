from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any

from backend.app.storage.database import (
    get_active_model_record,
    list_assessments
)
from backend.app.api.v1.auth import get_current_user, require_station_access

router = APIRouter(tags=["Evidence API"])

@router.get("/stations/{station_id}/evidence")
def get_station_evidence(
    station_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Return the latest assessment evidence and active model metadata for a station.
    RBAC: Admins can view any station; station operators only their own.
    """
    clean_id = station_id.strip().upper()
    # Enforce station access (admin passes, operator must match)
    require_station_access(clean_id, current_user)

    # Latest assessment (if any)
    assessments = list_assessments(clean_id, limit=1)
    latest_assessment = assessments[0] if assessments else None

    # Active model record (if any)
    active_model = get_active_model_record(clean_id)

    return {
        "station_id": clean_id,
        "latest_assessment": latest_assessment,
        "active_model": active_model,
    }
