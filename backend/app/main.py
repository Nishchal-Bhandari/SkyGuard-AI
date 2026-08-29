import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from backend.app.storage.database import init_db
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.stations import router as stations_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("skyguard.backend")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize SQLite database and tables
    logger.info("Initializing SkyGuard-AI SQLite Database & Schema...")
    init_db()
    logger.info("SQLite Database initialized successfully.")
    yield
    # Shutdown
    logger.info("SkyGuard-AI Backend service shutting down.")

app = FastAPI(
    title="SkyGuard-AI Tactical Backend Service",
    description="SQLite-backed Authentication, Station Provisioning & Machine Learning Infrastructure",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration for local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(stations_router, prefix="/api/v1")

@app.get("/api/v1/health", tags=["Diagnostics"])
def health_check():
    return {
        "status": "ONLINE",
        "service": "SkyGuard-AI Backend",
        "version": "2.0.0",
        "database": "SQLite (WAL Mode)",
        "security": "PBKDF2-HMAC-SHA256"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
