from fastapi import APIRouter, HTTPException, Depends, status, Body, BackgroundTasks, Response
from typing import Optional, Dict, Any, List
import json

from backend.app.storage.database import (
    get_active_model_record,
    list_station_models,
    list_training_jobs,
    get_training_job
)
from backend.app.services.training_service import training_service
from backend.app.services.model_storage import model_storage_service
from backend.app.api.v1.auth import get_current_user, require_admin, get_optional_user

router = APIRouter(tags=["Station-Adaptive MLOps Governance"])


@router.post("/stations/{station_id}/train")
def train_station_model(
    station_id: str,
    background_tasks: BackgroundTasks,
    payload: Optional[Dict[str, Any]] = Body(default={}),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Executes station-specific Isolation Forest training pipeline on Cloud PostgreSQL telemetry.
    Strictly isolated: Historical data for station_id ONLY is used.
    RBAC Rules:
      - Central Admin can initiate training for any station.
      - Station Operator can ONLY train their own assigned station.
    """
    clean_target_id = station_id.strip().upper()

    # RBAC Enforcement
    role = current_user.get("role")
    if role == "station_operator":
        user_station = str(current_user.get("station_id", "")).strip().upper()
        if user_station != clean_target_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Station identity violation: Authenticated as '{user_station}', cannot train model for '{clean_target_id}'."
            )

    custom_version = (payload or {}).get("version")

    try:
        result = training_service.start_training(clean_target_id, custom_version=custom_version)
        # Dispatch the heavy lifting to the background
        background_tasks.add_task(
            training_service.execute_training_job, 
            result["job_id"], 
            clean_target_id, 
            result["model_version"]
        )
        return result
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training pipeline execution failed: {str(e)}"
        )


@router.get("/stations/{station_id}/training-jobs/{job_id}/status")
def get_training_job_status(
    station_id: str,
    job_id: int,
    response: Response,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """Returns the current real-time status and stages of the training job."""
    clean_id = station_id.strip().upper()
    job = get_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
        
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    
    val = job.get("completed_stages")
    if isinstance(val, str):
        try:
            completed = json.loads(val or "[]")
        except Exception:
            completed = []
    elif isinstance(val, list):
        completed = val
    else:
        completed = []

    if job.get("status") == "COMPLETED":
        current_stage = "Model Activated"
        if "Model Activated" not in completed:
            completed.append("Model Activated")
        progress = 100.0
    else:
        current_stage = job.get("current_stage")
        progress = round((len(completed) / 8.0) * 100.0, 1)

    return {
        "success": True,
        "job_id": job["id"],
        "station_id": clean_id,
        "status": job["status"],
        "current_stage": current_stage,
        "completed_stages": completed,
        "progress": progress,
        "error_message": job.get("error_message")
    }


@router.get("/stations/{station_id}/training-jobs")
def get_station_training_jobs(
    station_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """
    Returns audit history of training jobs executed for station_id.
    """
    clean_id = station_id.strip().upper()
    jobs = list_training_jobs(clean_id)
    return {
        "success": True,
        "station_id": clean_id,
        "jobs": jobs
    }


@router.get("/stations/{station_id}/models")
def get_station_models(
    station_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """
    Returns all registered models (active and archived) for station_id from model_registry.
    """
    clean_id = station_id.strip().upper()
    models = list_station_models(clean_id)
    return {
        "success": True,
        "station_id": clean_id,
        "models": models
    }


@router.get("/stations/{station_id}/models/active")
def get_station_active_model(
    station_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)
):
    """
    Returns the currently ACTIVE model card and metadata for station_id.
    If no model has been trained, returns has_active_model: false.
    """
    clean_id = station_id.strip().upper()
    active_rec = get_active_model_record(clean_id)

    if not active_rec:
        return {
            "success": True,
            "station_id": clean_id,
            "has_active_model": False,
            "message": f"No active trained model calibrated for {clean_id} (COLD START / RULES ONLY)"
        }

    # Load complete model card from artifact storage
    artifact = model_storage_service.load_artifact(active_rec["model_location"])
    if not artifact:
        artifact = model_storage_service.load_by_station_and_id(clean_id, active_rec["model_id"])

    model_card = artifact.get("model_card") if artifact else None

    return {
        "success": True,
        "station_id": clean_id,
        "has_active_model": True,
        "model_record": active_rec,
        "model_card": model_card
    }


@router.post("/stations/{station_id}/models/{model_version}/rollback")
def rollback_station_model(
    station_id: str,
    model_version: str,
    admin_user: Dict[str, Any] = Depends(require_admin)
):
    """
    Rolls back the active model for station_id to a previously trained model version.
    Restricted strictly to Central Admin.
    """
    clean_id = station_id.strip().upper()
    try:
        res = rollback_model_version(clean_id, model_version)
        return res
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rollback failed: {str(e)}"
        )


@router.post("/stations/{station_id}/score")
def score_realtime_telemetry(
    station_id: str,
    payload: Dict[str, Any] = Body(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Evaluates real-time observation using the dedicated ACTIVE Isolation Forest model for station_id.
    Returns MODEL_NOT_TRAINED if no active model is found for this station.
    """
    clean_id = station_id.strip().upper()
    obs = payload.get("observation", payload)
    last_obs = payload.get("last_observation")
    score_res = training_service.score_observation(clean_id, obs, last_obs)
    return score_res
