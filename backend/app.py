"""
SkyGuard AI — REST API Backend Server
Exposes end-to-end endpoints for:
1. CSV Upload & Station-Specific Model Training (/api/upload-csv)
2. Real-Time Anomaly Detection (/api/detect-anomaly)
3. Station Model Status Retrieval (/api/station-status/{station_id})
"""

import io
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services import (
    train_station_model,
    detect_anomaly,
    has_station_model,
    load_station_artifacts,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("skyguard_api")

app = FastAPI(
    title="SkyGuard AI — Anomaly Detection Service",
    description="Station-Adaptive Isolation Forest Anomaly Detection API for Automatic Weather Stations",
    version="1.0.0"
)

# Enable CORS for React frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request Models
class RealtimeObservationRequest(BaseModel):
    station_id: str = Field(..., example="AWS_001", description="Unique Weather Station ID")
    timestamp: str = Field(..., example="2026-08-29 14:30:00", description="ISO or standard timestamp")
    temperature: float = Field(..., example=55.0, description="Temperature in °C")
    pressure: float = Field(..., example=1008.0, description="Atmospheric Pressure in hPa")
    humidity: float = Field(..., example=98.0, description="Relative Humidity in %")


@app.get("/")
def health_check():
    return {
        "system": "SkyGuard AI Anomaly Detection Engine",
        "status": "ONLINE",
        "supported_features": [
            "Station-adaptive Isolation Forest training",
            "Zero pre-trained model cold start",
            "CSV column auto-normalization",
            "Temporal context rolling buffer",
            "Severity classification & explanations"
        ]
    }


@app.post("/api/upload-csv")
async def upload_csv_and_train(
    station_id: str = Form(..., description="Unique Station Identifier (e.g., AWS_001)"),
    file: UploadFile = File(..., description="Historical Weather Station CSV File")
):
    """
    Step 1 - Step 7: Uploads historical station CSV data, validates, preprocesses,
    trains Isolation Forest model from scratch, and persists model artifacts for station_id.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Please upload a CSV file."
        )

    try:
        contents = await file.read()
        csv_bytes = io.BytesIO(contents)

        metadata, summary_text = train_station_model(
            station_id=station_id,
            csv_source=csv_bytes
        )

        return {
            "success": True,
            "message": f"Successfully trained and saved model for station '{station_id}'",
            "summary_text": summary_text,
            "metadata": metadata
        }

    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Error during model training for station '{station_id}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to train model for '{station_id}': {str(e)}"
        )


@app.post("/api/detect-anomaly")
def detect_realtime_anomaly(request: RealtimeObservationRequest):
    """
    Step 8: Performs real-time anomaly detection on incoming station observation.
    Uses saved station model, scaler, and recent-data context buffer.
    """
    try:
        observation_dict = request.model_dump()
        result = detect_anomaly(observation_dict)
        return result

    except FileNotFoundError as fnf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(fnf)
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Error during anomaly detection for station '{request.station_id}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Real-time anomaly detection failed: {str(e)}"
        )


@app.get("/api/station-status/{station_id}")
def get_station_status(station_id: str):
    """
    Returns model status, metadata, and statistics for a given weather station.
    """
    is_trained = has_station_model(station_id)
    if not is_trained:
        return {
            "station_id": station_id,
            "has_model": False,
            "status": "UNINITIALIZED",
            "message": f"No active trained model found for station '{station_id}'. Please upload historical CSV."
        }

    try:
        _, _, _, metadata = load_station_artifacts(station_id)
        return {
            "station_id": station_id,
            "has_model": True,
            "status": "READY",
            "metadata": metadata
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load station status: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
