import logging
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from backend.app.config import IS_POSTGRES
from backend.app.storage.database import init_db
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.stations import router as stations_router
from backend.app.api.v1.telemetry import router as telemetry_router
from backend.app.api.v1.models import router as models_router
from backend.app.api.v1.faults import router as faults_router
from backend.app.api.v1.incidents import router as incidents_router
from backend.app.services.weather_service import weather_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("skyguard.backend")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Database & Schema
    db_type = "Cloud PostgreSQL / TimescaleDB" if IS_POSTGRES else "SQLite (WAL Mode)"
    logger.info(f"Initializing SkyGuard-AI Database ({db_type})...")
    init_db()
    logger.info(f"Database schema initialized successfully ({db_type}).")
    
    # Start Background Weather Poller
    weather_task = asyncio.create_task(weather_service.poll_loop())
    
    yield
    # Shutdown
    logger.info("SkyGuard-AI Backend service shutting down.")
    weather_service.stop()
    try:
        await asyncio.wait_for(weather_task, timeout=2.0)
    except asyncio.TimeoutError:
        pass

app = FastAPI(
    title="SkyGuard-AI Tactical Backend Service",
    description="Cloud PostgreSQL & TimescaleDB Telemetry Ingestion, Station Provisioning & Station-Adaptive MLOps Pipeline",
    version="2.1.0",
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
# IMPORTANT: telemetry_router must be registered before stations_router.
# stations_router has a wildcard route `GET /stations/{station_id}` that would
# shadow `/stations/{station_id}/telemetry/stats` if mounted first.
app.include_router(auth_router, prefix="/api/v1")
app.include_router(telemetry_router, prefix="/api/v1")
app.include_router(models_router, prefix="/api/v1")
app.include_router(faults_router, prefix="/api/v1")
app.include_router(incidents_router, prefix="/api/v1")
app.include_router(stations_router, prefix="/api/v1")

@app.get("/api/v1/health", tags=["Diagnostics"])
def health_check():
    return {
        "status": "ONLINE",
        "service": "SkyGuard-AI Backend",
        "version": "2.1.0",
        "database": "Cloud PostgreSQL / TimescaleDB" if IS_POSTGRES else "SQLite (WAL Mode)",
        "security": "PBKDF2-HMAC-SHA256 / JWT HS256",
        "mlops": "Station-Adaptive Isolation Forest"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
