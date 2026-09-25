import os
import re
import json
import sqlite3
import datetime
import logging
import hashlib
from pathlib import Path
from contextlib import contextmanager
from typing import Generator, Any, Dict, List, Optional, Tuple

logger = logging.getLogger("skyguard.database")

from backend.app.config import (
    DATABASE_URL,
    DATABASE_SSL_MODE,
    IS_POSTGRES,
    DATA_DIR,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_NAME
)
from backend.app.auth.security import hash_password

# Try importing psycopg2 when in PostgreSQL mode
try:
    import psycopg2
    import psycopg2.pool
    from psycopg2.extras import RealDictCursor
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

_pg_pool: Optional[Any] = None

def get_pg_pool():
    global _pg_pool
    if _pg_pool is None and IS_POSTGRES and PSYCOPG2_AVAILABLE:
        connect_kwargs = {"connect_timeout": 3}
        if "sslmode" not in DATABASE_URL.lower():
            connect_kwargs["sslmode"] = DATABASE_SSL_MODE
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            dsn=DATABASE_URL,
            **connect_kwargs
        )
    return _pg_pool


class DBWrapperCursor:
    """
    Unified cursor wrapper providing dictionary-like row access, automatic
    placeholder conversion (? -> %s for PostgreSQL), and consistent lastrowid.
    """
    def __init__(self, raw_cursor, is_postgres: bool):
        self.cursor = raw_cursor
        self.is_postgres = is_postgres
        self.lastrowid = getattr(raw_cursor, "lastrowid", None)

    def execute(self, sql: str, params: Optional[Tuple[Any, ...]] = None):
        cleaned_sql = sql
        if self.is_postgres:
            # Replace sqlite '?' placeholders with postgres '%s'
            cleaned_sql = re.sub(r'\?', '%s', cleaned_sql)
            # Handle sqlite COLLATE NOCASE
            cleaned_sql = cleaned_sql.replace("COLLATE NOCASE", "")
        
        if params is not None:
            self.cursor.execute(cleaned_sql, params)
        else:
            self.cursor.execute(cleaned_sql)

        self.lastrowid = getattr(self.cursor, "lastrowid", None)
        return self

    def executemany(self, sql: str, seq_of_params):
        cleaned_sql = sql
        if self.is_postgres:
            cleaned_sql = re.sub(r'\?', '%s', cleaned_sql)
            cleaned_sql = cleaned_sql.replace("COLLATE NOCASE", "")
        self.cursor.executemany(cleaned_sql, seq_of_params)
        return self

    def fetchone(self):
        row = self.cursor.fetchone()
        if row is None:
            return None
        if isinstance(row, dict):
            return row
        # Convert sqlite3.Row or tuple to dict-like
        return dict(row)

    def fetchall(self):
        rows = self.cursor.fetchall()
        if not rows:
            return []
        if isinstance(rows[0], dict):
            return rows
        return [dict(r) for r in rows]

    @property
    def rowcount(self):
        return getattr(self.cursor, "rowcount", -1)

    def close(self):
        self.cursor.close()


class DBConnectionWrapper:
    """
    Unified database connection wrapper supporting transactions, rollback,
    and cursor factory.
    """
    def __init__(self, raw_conn, is_postgres: bool):
        self.conn = raw_conn
        self.is_postgres = is_postgres

    def cursor(self):
        if self.is_postgres:
            raw_cur = self.conn.cursor(cursor_factory=RealDictCursor)
        else:
            raw_cur = self.conn.cursor()
        return DBWrapperCursor(raw_cur, self.is_postgres)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


@contextmanager
def get_db() -> Generator[DBConnectionWrapper, None, None]:
    """
    Context manager providing a database connection with row factory
    and enforced transaction integrity across PostgreSQL and SQLite.
    Uses ThreadedConnectionPool for PostgreSQL for zero-latency queries.
    """
    if IS_POSTGRES:
        if not PSYCOPG2_AVAILABLE:
            logger.warning("psycopg2 is not available. Falling back to local SQLite.")
            use_pg = False
        else:
            try:
                pool = get_pg_pool()
                raw_conn = pool.getconn()
                use_pg = True
            except Exception as e:
                # Log once and fallback to local SQLite for offline resilience
                use_pg = False

        if use_pg:
            conn = DBConnectionWrapper(raw_conn, is_postgres=True)
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                pool.putconn(raw_conn)
            return

    # SQLite mode (Default or Fallback)
    db_path_str = DATABASE_URL
    if db_path_str.startswith("sqlite:///"):
        db_path_str = db_path_str[10:]
    elif "://" in db_path_str:
        db_path_str = str(DATA_DIR / "skyguard.db")
    sqlite_file = Path(db_path_str)
    sqlite_file.parent.mkdir(parents=True, exist_ok=True)

    raw_conn = sqlite3.connect(str(sqlite_file), timeout=25.0)
    raw_conn.row_factory = sqlite3.Row
    raw_conn.execute("PRAGMA foreign_keys = ON;")
    raw_conn.execute("PRAGMA journal_mode = WAL;")
    conn = DBConnectionWrapper(raw_conn, is_postgres=False)

    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# Database Schema Initialization (Idempotent)
# -----------------------------------------------------------------------------

def init_db():
    """
    Initializes database tables, composite indexes, and initial admin/fleet seeds idempotently.
    Supports both Cloud PostgreSQL / TimescaleDB and SQLite.
    """
    with get_db() as conn:
        cur = conn.cursor()

        if conn.is_postgres:
            # 1. PostgreSQL Schema
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admins (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(64) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(128) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMPTZ
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS stations (
                    id SERIAL PRIMARY KEY,
                    station_id VARCHAR(32) UNIQUE NOT NULL,
                    station_name VARCHAR(128) NOT NULL,
                    username VARCHAR(64) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    access_key VARCHAR(128) DEFAULT 'sentinel2026',
                    latitude DOUBLE PRECISION NOT NULL,
                    longitude DOUBLE PRECISION NOT NULL,
                    elevation DOUBLE PRECISION DEFAULT 0.0,
                    region VARCHAR(128) DEFAULT 'General',
                    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
                    created_by VARCHAR(64) NOT NULL DEFAULT 'admin',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMPTZ
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS telemetry (
                    id BIGSERIAL,
                    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
                    timestamp TIMESTAMPTZ NOT NULL,
                    grid_point VARCHAR(32) NOT NULL DEFAULT '',
                    temperature DOUBLE PRECISION,
                    humidity DOUBLE PRECISION,
                    pressure DOUBLE PRECISION,
                    wind_speed DOUBLE PRECISION,
                    wind_direction DOUBLE PRECISION,
                    rainfall DOUBLE PRECISION,
                    solar DOUBLE PRECISION,
                    battery DOUBLE PRECISION DEFAULT 12.6,
                    signal DOUBLE PRECISION DEFAULT -70.0,
                    raw_payload TEXT,
                    qc_flag VARCHAR(32) DEFAULT 'RAW',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id, timestamp)
                );
            """)

            # Optional hypertable attempt
            try:
                cur.execute("SELECT create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE);")
            except Exception:
                pass

            cur.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_station_id ON telemetry(station_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp DESC);")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station_id, timestamp, grid_point);")

            # Idempotent migration: add grid_point column if this is an existing DB
            # that was created before the grid_point column was introduced.
            try:
                cur.execute("""
                    ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS grid_point VARCHAR(32) NOT NULL DEFAULT '';
                """)
            except Exception:
                pass  # Column already exists

            # Migrate unique index: drop old (station_id, timestamp) index and replace
            # with the new (station_id, timestamp, grid_point) composite index.
            try:
                cur.execute("DROP INDEX IF EXISTS idx_telemetry_station_ts;")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station_id, timestamp, grid_point);")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS training_jobs (
                    id SERIAL PRIMARY KEY,
                    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                    current_stage VARCHAR(64) DEFAULT 'Data Ingested',
                    completed_stages TEXT DEFAULT '[]',
                    started_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    rows_used INTEGER DEFAULT 0,
                    feature_count INTEGER DEFAULT 8,
                    model_version VARCHAR(32),
                    error_message TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_training_jobs_station ON training_jobs(station_id, created_at DESC);")
            
            try:
                cur.execute("ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS current_stage VARCHAR(64) DEFAULT 'Data Ingested';")
                cur.execute("ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS completed_stages TEXT DEFAULT '[]';")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS active_faults (
                    station_id VARCHAR(32) PRIMARY KEY REFERENCES stations(station_id) ON DELETE CASCADE,
                    fault_type VARCHAR(64) NOT NULL,
                    offset_val DOUBLE PRECISION,
                    injected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS station_qc_config (
                    station_id VARCHAR(32) PRIMARY KEY REFERENCES stations(station_id) ON DELETE CASCADE,
                    temperature_normal_min DOUBLE PRECISION,
                    temperature_normal_max DOUBLE PRECISION,
                    humidity_normal_min DOUBLE PRECISION,
                    humidity_normal_max DOUBLE PRECISION,
                    pressure_normal_min DOUBLE PRECISION,
                    pressure_normal_max DOUBLE PRECISION,
                    wind_normal_min DOUBLE PRECISION,
                    wind_normal_max DOUBLE PRECISION,
                    calibration_method VARCHAR(64) NOT NULL DEFAULT 'HISTORICAL_PERCENTILE_98',
                    calibration_record_count INTEGER NOT NULL DEFAULT 0,
                    calibrated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    version INTEGER NOT NULL DEFAULT 1
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id VARCHAR(64) PRIMARY KEY,
                    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
                    station_name VARCHAR(128),
                    variable VARCHAR(64) NOT NULL DEFAULT 'air_temperature',
                    severity VARCHAR(32) NOT NULL DEFAULT 'high',
                    fault_risk DOUBLE PRECISION NOT NULL DEFAULT 0.85,
                    quality_state VARCHAR(64) NOT NULL DEFAULT 'LOCALIZED_ANOMALY',
                    reason_codes TEXT NOT NULL DEFAULT '[]',
                    explanation TEXT NOT NULL DEFAULT '',
                    recommended_actions TEXT NOT NULL DEFAULT '[]',
                    evidence_ids TEXT NOT NULL DEFAULT '[]',
                    evidence_data TEXT NOT NULL DEFAULT '{}',
                    status VARCHAR(32) NOT NULL DEFAULT 'open',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    adjudicated_at TIMESTAMPTZ,
                    adjudicated_by VARCHAR(64),
                    action_taken VARCHAR(64)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_station_status ON incidents(station_id, status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);")

            try:
                cur.execute("ALTER TABLE incidents ADD COLUMN IF NOT EXISTS evidence_data TEXT NOT NULL DEFAULT '{}';")
            except Exception:
                pass
            try:
                cur.execute("ALTER TABLE incidents ADD COLUMN IF NOT EXISTS normal_streak INTEGER NOT NULL DEFAULT 0;")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS model_registry (
                    id SERIAL PRIMARY KEY,
                    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
                    model_id VARCHAR(64) UNIQUE NOT NULL,
                    model_version VARCHAR(32) NOT NULL,
                    model_type VARCHAR(64) NOT NULL DEFAULT 'IsolationForest',
                    model_location VARCHAR(255) NOT NULL,
                    feature_schema TEXT,
                    training_rows INTEGER NOT NULL,
                    threshold DOUBLE PRECISION NOT NULL,
                    contamination_rate DOUBLE PRECISION DEFAULT 0.05,
                    sha256 VARCHAR(64) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
                    training_started_at TIMESTAMPTZ,
                    training_completed_at TIMESTAMPTZ,
                    metrics TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_model_registry_station ON model_registry(station_id, status);")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS models (
                    id SERIAL PRIMARY KEY,
                    station_id VARCHAR(32) NOT NULL,
                    model_id VARCHAR(64) UNIQUE NOT NULL,
                    model_version VARCHAR(32) NOT NULL DEFAULT 'v1.0',
                    algorithm VARCHAR(64) NOT NULL DEFAULT 'IsolationForest',
                    dynamic_threshold DOUBLE PRECISION NOT NULL,
                    contamination_rate DOUBLE PRECISION DEFAULT 0.05,
                    sha256_hash VARCHAR(64) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
                    trained_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    training_samples INTEGER DEFAULT 0
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS auth_audit_logs (
                    id SERIAL PRIMARY KEY,
                    actor_username VARCHAR(64) NOT NULL,
                    role VARCHAR(32) NOT NULL,
                    event_type VARCHAR(64) NOT NULL,
                    ip_address VARCHAR(45),
                    status VARCHAR(16) NOT NULL,
                    details TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_auth_audit_actor ON auth_audit_logs(actor_username);")

        else:
            # 2. SQLite Schema
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login TEXT
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS stations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    station_name TEXT NOT NULL,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    access_key TEXT DEFAULT 'sentinel2026',
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    elevation REAL DEFAULT 0,
                    region TEXT DEFAULT 'General',
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    created_by TEXT NOT NULL DEFAULT 'admin',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login TEXT
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    grid_point TEXT NOT NULL DEFAULT '',
                    temperature REAL,
                    humidity REAL,
                    pressure REAL,
                    wind_speed REAL,
                    wind_direction REAL,
                    rainfall REAL,
                    solar REAL,
                    battery REAL DEFAULT 12.6,
                    signal REAL DEFAULT -70.0,
                    raw_payload TEXT,
                    qc_flag TEXT DEFAULT 'RAW',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_station_id ON telemetry(station_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp);")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station_id, timestamp, grid_point);")

            # Idempotent migration: add grid_point column if this is an existing SQLite
            # DB that was created before the grid_point column was introduced.
            try:
                cur.execute("ALTER TABLE telemetry ADD COLUMN grid_point TEXT NOT NULL DEFAULT '';")
            except Exception:
                pass  # Column already exists — sqlite3 raises OperationalError

            # Migrate unique index: drop old 2-column index and create 3-column one.
            try:
                cur.execute("DROP INDEX IF EXISTS idx_telemetry_station_ts;")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station_id, timestamp, grid_point);")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS training_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    current_stage TEXT DEFAULT 'Data Ingested',
                    completed_stages TEXT DEFAULT '[]',
                    started_at TEXT,
                    completed_at TEXT,
                    rows_used INTEGER DEFAULT 0,
                    feature_count INTEGER DEFAULT 8,
                    model_version TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_training_jobs_station ON training_jobs(station_id, created_at);")

            try:
                cur.execute("ALTER TABLE training_jobs ADD COLUMN current_stage TEXT DEFAULT 'Data Ingested';")
            except Exception:
                pass
            try:
                cur.execute("ALTER TABLE training_jobs ADD COLUMN completed_stages TEXT DEFAULT '[]';")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS active_faults (
                    station_id TEXT PRIMARY KEY,
                    fault_type TEXT NOT NULL,
                    offset_val REAL,
                    injected_at TEXT NOT NULL,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS station_qc_config (
                    station_id TEXT PRIMARY KEY,
                    temperature_normal_min REAL,
                    temperature_normal_max REAL,
                    humidity_normal_min REAL,
                    humidity_normal_max REAL,
                    pressure_normal_min REAL,
                    pressure_normal_max REAL,
                    wind_normal_min REAL,
                    wind_normal_max REAL,
                    calibration_method TEXT NOT NULL DEFAULT 'HISTORICAL_PERCENTILE_98',
                    calibration_record_count INTEGER NOT NULL DEFAULT 0,
                    calibrated_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id TEXT PRIMARY KEY,
                    station_id TEXT NOT NULL,
                    station_name TEXT,
                    variable TEXT NOT NULL DEFAULT 'air_temperature',
                    severity TEXT NOT NULL DEFAULT 'high',
                    fault_risk REAL NOT NULL DEFAULT 0.85,
                    quality_state TEXT NOT NULL DEFAULT 'LOCALIZED_ANOMALY',
                    reason_codes TEXT NOT NULL DEFAULT '[]',
                    explanation TEXT NOT NULL DEFAULT '',
                    recommended_actions TEXT NOT NULL DEFAULT '[]',
                    evidence_ids TEXT NOT NULL DEFAULT '[]',
                    evidence_data TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    adjudicated_at TEXT,
                    adjudicated_by TEXT,
                    action_taken TEXT,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_station_status ON incidents(station_id, status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);")

            try:
                cur.execute("ALTER TABLE incidents ADD COLUMN evidence_data TEXT NOT NULL DEFAULT '{}';")
            except Exception:
                pass
            try:
                cur.execute("ALTER TABLE incidents ADD COLUMN normal_streak INTEGER NOT NULL DEFAULT 0;")
            except Exception:
                pass

            cur.execute("""
                CREATE TABLE IF NOT EXISTS model_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    model_id TEXT UNIQUE NOT NULL,
                    model_version TEXT NOT NULL DEFAULT 'v1.0',
                    model_type TEXT NOT NULL DEFAULT 'IsolationForest',
                    model_location TEXT NOT NULL,
                    feature_schema TEXT,
                    training_rows INTEGER NOT NULL,
                    threshold REAL NOT NULL,
                    contamination_rate REAL DEFAULT 0.05,
                    sha256 TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    training_started_at TEXT,
                    training_completed_at TEXT,
                    metrics TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS models (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    model_id TEXT UNIQUE NOT NULL,
                    model_version TEXT NOT NULL DEFAULT 'v1.0',
                    algorithm TEXT NOT NULL DEFAULT 'IsolationForest',
                    dynamic_threshold REAL NOT NULL,
                    contamination_rate REAL DEFAULT 0.05,
                    sha256_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    trained_at TEXT NOT NULL,
                    training_samples INTEGER DEFAULT 0,
                    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS auth_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actor_username TEXT NOT NULL,
                    role TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    ip_address TEXT,
                    status TEXT NOT NULL,
                    details TEXT,
                    created_at TEXT NOT NULL
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS retraining_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    model_version TEXT NOT NULL,
                    shadow_score REAL,
                    anomaly_rate REAL,
                    is_promoted BOOLEAN DEFAULT 0,
                    created_at TEXT NOT NULL
                );
            """)
            
            cur.execute("""
                CREATE TABLE IF NOT EXISTS drift_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id TEXT NOT NULL,
                    anomaly_rate REAL,
                    score_mean REAL,
                    score_std REAL,
                    recorded_at TEXT NOT NULL
                );
            """)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_stations_station_id ON stations(station_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_stations_username ON stations(username);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_stations_status ON stations(status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);")

        # -----------------------------------------------------------------
        # Additive intelligence and audit entities shared by SQLite/Postgres
        # -----------------------------------------------------------------
        # These tables are intentionally append-oriented. They keep the raw
        # telemetry contract separate from assessments, repairs, and model state.
        extended_tables = [
            """CREATE TABLE IF NOT EXISTS assessments (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                source_timestamp TEXT NOT NULL,
                quality_state TEXT NOT NULL,
                severity TEXT NOT NULL,
                classification TEXT NOT NULL,
                anomaly_score REAL,
                confidence TEXT,
                evidence_completeness REAL,
                evidence_data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS imputations (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                source_timestamp TEXT NOT NULL,
                parameter TEXT NOT NULL,
                raw_value REAL,
                imputed_value REAL,
                method TEXT NOT NULL,
                peer_list TEXT NOT NULL DEFAULT '[]',
                confidence REAL,
                assessment_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS sensor_health (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                source_timestamp TEXT NOT NULL,
                temperature_score REAL,
                humidity_score REAL,
                pressure_score REAL,
                station_score REAL,
                evidence_data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS station_climatology (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                parameter TEXT NOT NULL,
                coefficients TEXT NOT NULL DEFAULT '{}',
                robust_sigma REAL,
                observation_count INTEGER NOT NULL DEFAULT 0,
                model_version TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS fusion_coefficients (
                id INTEGER PRIMARY KEY,
                version TEXT NOT NULL,
                coefficients TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'DEFAULT_PRIORS',
                validation_metrics TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS station_neighbours (
                station_id TEXT NOT NULL,
                peer_station_id TEXT NOT NULL,
                distance_km REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (station_id, peer_station_id)
            )""",
            """CREATE TABLE IF NOT EXISTS ingest_idempotency (
                station_id TEXT NOT NULL,
                source_timestamp TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'ACCEPTED',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (station_id, source_timestamp)
            )""",
            """CREATE TABLE IF NOT EXISTS shadow_scores (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                model_version TEXT NOT NULL,
                source_timestamp TEXT NOT NULL,
                incumbent_score REAL,
                candidate_score REAL,
                result TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS drift_metrics (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                model_version TEXT,
                metric_name TEXT NOT NULL,
                metric_value REAL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS retraining_candidates (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                model_version TEXT NOT NULL,
                gate_status TEXT NOT NULL DEFAULT 'PENDING',
                gate_results TEXT NOT NULL DEFAULT '{}',
                artifact_hash TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS config_audit (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                before_state TEXT,
                after_state TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS sensor_change_events (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                parameter TEXT,
                action TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                actor TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS maintenance_tasks (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                task_key TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                done INTEGER NOT NULL DEFAULT 0,
                completed_by TEXT,
                completed_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(station_id, task_key)
            )""",
            """CREATE TABLE IF NOT EXISTS maintenance_audit (
                id INTEGER PRIMARY KEY,
                station_id TEXT NOT NULL,
                actor TEXT NOT NULL,
                snapshot TEXT NOT NULL DEFAULT '{}',
                signature_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        ]
        for table_sql in extended_tables:
            cur.execute(table_sql)

        cur.execute("CREATE INDEX IF NOT EXISTS idx_assessments_station_time ON assessments(station_id, source_timestamp);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_health_station_time ON sensor_health(station_id, source_timestamp);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_station ON maintenance_tasks(station_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_maintenance_audit_station ON maintenance_audit(station_id, id);")

        # SQLite trigger is the final guard against accidental raw updates.
        if not conn.is_postgres:
            cur.execute("""
                CREATE TRIGGER IF NOT EXISTS prevent_telemetry_raw_update
                BEFORE UPDATE OF station_id, timestamp, grid_point, temperature, humidity,
                    pressure, wind_speed, wind_direction, rainfall, solar, battery, signal,
                    raw_payload, qc_flag ON telemetry
                BEGIN
                    SELECT RAISE(ABORT, 'raw telemetry is immutable; append a new record');
                END;
            """)

        # ---------------------------------------------------------------------
        # Idempotent Seed Data
        # ---------------------------------------------------------------------
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # Seed initial admin if missing
        cur.execute("SELECT id FROM admins WHERE username = ?", (DEFAULT_ADMIN_USERNAME.lower(),))
        if not cur.fetchone():
            pwd_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
            cur.execute("""
                INSERT INTO admins (username, password_hash, full_name, status, created_at, updated_at)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?);
            """, (DEFAULT_ADMIN_USERNAME.lower(), pwd_hash, DEFAULT_ADMIN_NAME, now_iso, now_iso))
            print(f"[Database] Seeded Central Admin: '{DEFAULT_ADMIN_USERNAME}'")





# -----------------------------------------------------------------------------
# Data Access Layer & Helper Operations
# -----------------------------------------------------------------------------


def insert_telemetry_batch(station_id: str, records: List[Dict[str, Any]]) -> Tuple[int, int]:
    """
    Inserts a batch of telemetry records atomically for station_id.
    Existing source timestamps are ignored rather than overwritten. The
    idempotency ledger records accepted rows and duplicate payload hashes.
    Returns (inserted_count, error_count).
    """
    if not records:
        return 0, 0

    clean_station_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    dedup_map = {}
    error_count = 0
    for r in records:
        try:
            ts = r.get("timestamp")
            if isinstance(ts, datetime.datetime):
                ts_str = ts.isoformat()
            else:
                ts_str = str(ts)

            grid_point = str(r.get("grid_point", ""))

            temp = float(r["temp"]) if r.get("temp") is not None else None
            hum = float(r["hum"]) if r.get("hum") is not None else None
            pres = float(r["pres"]) if r.get("pres") is not None else None
            wind = float(r["wind"]) if r.get("wind") is not None else None
            wind_dir = float(r.get("wind_direction", 0.0))
            rain = float(r["rain"]) if r.get("rain") is not None else 0.0
            solar = float(r.get("solar", 0.0))
            battery = float(r.get("battery", 12.6))
            signal = float(r.get("signal", -70.0))
            qc_flag = str(r.get("qc_flag", "VALID"))
            raw_payload = json.dumps(r.get("raw_payload", {}))

            dedup_map[(clean_station_id, ts_str, grid_point)] = (
                clean_station_id, ts_str, grid_point, temp, hum, pres,
                wind, wind_dir, rain, solar, battery, signal,
                raw_payload, qc_flag, now_iso
            )
        except Exception:
            error_count += 1

    param_tuples = list(dedup_map.values())
    if not param_tuples:
        return 0, error_count

    sql_pg = """
        INSERT INTO telemetry (
            station_id, timestamp, grid_point, temperature, humidity, pressure,
            wind_speed, wind_direction, rainfall, solar, battery, signal,
            raw_payload, qc_flag, created_at
        ) VALUES %s
        ON CONFLICT (station_id, timestamp, grid_point) DO NOTHING;
    """

    sql_sqlite = """
        INSERT INTO telemetry (
            station_id, timestamp, grid_point, temperature, humidity, pressure,
            wind_speed, wind_direction, rainfall, solar, battery, signal,
            raw_payload, qc_flag, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(station_id, timestamp, grid_point) DO NOTHING;
    """

    with get_db() as conn:
        before_count = 0
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS count FROM telemetry WHERE station_id = ?", (clean_station_id,))
        before_count = int((cur.fetchone() or {}).get("count", 0))
        if conn.is_postgres and PSYCOPG2_AVAILABLE:
            from psycopg2.extras import execute_values
            raw_cur = conn.conn.cursor()
            execute_values(raw_cur, sql_pg, param_tuples, page_size=2000)
            raw_cur.close()
        else:
            cur.executemany(sql_sqlite, param_tuples)
        cur.execute("SELECT COUNT(*) AS count FROM telemetry WHERE station_id = ?", (clean_station_id,))
        after_count = int((cur.fetchone() or {}).get("count", 0))
        inserted_count = max(0, after_count - before_count)

        # Keep an append-only source timestamp ledger for replay and conflict review.
        ledger_rows = []
        for values in param_tuples:
            payload_hash = hashlib.sha256(json.dumps(values, default=str).encode()).hexdigest()
            ledger_rows.append((values[0], values[1], payload_hash, "ACCEPTED"))
        if ledger_rows:
            sql_ledger = """
                INSERT INTO ingest_idempotency (station_id, source_timestamp, payload_hash, state)
                VALUES %s
                ON CONFLICT(station_id, source_timestamp) DO NOTHING
            """
            sql_ledger_sqlite = """
                INSERT INTO ingest_idempotency (station_id, source_timestamp, payload_hash, state)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(station_id, source_timestamp) DO NOTHING
            """
            if conn.is_postgres and PSYCOPG2_AVAILABLE:
                from psycopg2.extras import execute_values
                raw_cur = conn.conn.cursor()
                execute_values(raw_cur, sql_ledger, ledger_rows, page_size=2000)
                raw_cur.close()
            else:
                cur.executemany(sql_ledger_sqlite, ledger_rows)

    return inserted_count, error_count


def persist_assessment(station_id: str, assessment: Dict[str, Any], source_timestamp: Optional[str] = None) -> None:
    """Persist an additive assessment record without changing raw telemetry."""
    clean_id = station_id.strip().upper()
    timestamp = source_timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM assessments")
            next_id = int((cur.fetchone() or {}).get("next_id", 1))
        else:
            next_id = None
        columns = "id, station_id, source_timestamp, quality_state, severity, classification, anomaly_score, confidence, evidence_completeness, evidence_data"
        values = (next_id, clean_id, timestamp, assessment.get("quality_state", "VALID"), assessment.get("severity", "NONE"), assessment.get("classification", "NORMAL"), assessment.get("anomaly_score"), assessment.get("confidence"), assessment.get("evidence_completeness"), json.dumps(assessment, default=str)) if next_id is not None else (clean_id, timestamp, assessment.get("quality_state", "VALID"), assessment.get("severity", "NONE"), assessment.get("classification", "NORMAL"), assessment.get("anomaly_score"), assessment.get("confidence"), assessment.get("evidence_completeness"), json.dumps(assessment, default=str))
        placeholders = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?" if next_id is not None else "?, ?, ?, ?, ?, ?, ?, ?, ?"
        if next_id is None:
            columns = "station_id, source_timestamp, quality_state, severity, classification, anomaly_score, confidence, evidence_completeness, evidence_data"
        cur.execute("""
            INSERT INTO assessments (""" + columns + ") VALUES (" + placeholders + ")", values)


def _decode_assessment_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Convert persisted JSON evidence into the API assessment contract."""
    if not row:
        return None
    result = dict(row)
    raw_evidence = result.pop("evidence_data", "{}")
    try:
        evidence = json.loads(raw_evidence) if isinstance(raw_evidence, str) else raw_evidence
    except json.JSONDecodeError:
        evidence = {}
    result["assessment_id"] = result.pop("id")
    result["evidence"] = evidence if isinstance(evidence, dict) else {}
    return result


def get_latest_assessment(station_id: str) -> Optional[Dict[str, Any]]:
    """Return the most recently persisted assessment for a station."""
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM assessments
            WHERE station_id = ?
            ORDER BY source_timestamp DESC, id DESC
            LIMIT 1
        """, (clean_id,))
        return _decode_assessment_row(cur.fetchone())


def list_assessments(station_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Return bounded, newest-first assessment history for a station."""
    clean_id = station_id.strip().upper()
    safe_limit = max(1, min(int(limit), 500))
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM assessments
            WHERE station_id = ?
            ORDER BY source_timestamp DESC, id DESC
            LIMIT ?
        """, (clean_id, safe_limit))
        results = []
        for row in cur.fetchall():
            dec = _decode_assessment_row(row)
            if dec is not None:
                results.append(dec)
        return results


def get_station_telemetry_stats(station_id: str) -> Dict[str, Any]:
    """
    Returns telemetry record counts, timestamp boundaries, and latest observation for station_id.
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT COUNT(*) as total_records,
                   MIN(timestamp) as earliest_timestamp,
                   MAX(timestamp) as latest_timestamp
            FROM telemetry
            WHERE station_id = ?
        """, (clean_id,))
        stats = cur.fetchone() or {"total_records": 0, "earliest_timestamp": None, "latest_timestamp": None}

        # Latest observation
        cur.execute("""
            SELECT timestamp, temperature, humidity, pressure, wind_speed, rainfall, battery, signal
            FROM telemetry
            WHERE station_id = ?
            ORDER BY timestamp DESC
            LIMIT 1
        """, (clean_id,))
        latest = cur.fetchone()

        return {
            "station_id": clean_id,
            "total_records": stats.get("total_records", 0),
            "earliest_timestamp": stats.get("earliest_timestamp"),
            "latest_timestamp": stats.get("latest_timestamp"),
            "latest_observation": latest
        }


def fetch_historical_telemetry(station_id: str, limit: int = 50000) -> List[Dict[str, Any]]:
    """
    Retrieves historical telemetry specifically and strictly for station_id in chronological order.
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT timestamp, temperature as temp, humidity as hum, pressure as pres,
                   wind_speed as wind, rainfall as rain, solar, battery, signal, qc_flag
            FROM telemetry
            WHERE station_id = ?
            ORDER BY timestamp ASC
            LIMIT ?
        """, (clean_id, limit))
        rows = cur.fetchall()
        return [dict(r) for r in rows]


def create_training_job(station_id: str, model_version: str) -> int:
    """
    Inserts a new training job in RUNNING status and returns the generated job ID.
    """
    clean_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO training_jobs (station_id, status, current_stage, completed_stages, started_at, model_version, created_at)
            VALUES (?, 'RUNNING', 'Data Ingested', '[]', ?, ?, ?)
        """, (clean_id, now_iso, model_version, now_iso))
        
        if conn.is_postgres:
            cur.execute("SELECT id FROM training_jobs WHERE station_id = ? ORDER BY id DESC LIMIT 1", (clean_id,))
            row = cur.fetchone()
            return row["id"] if row else 1
        return cur.lastrowid or 1


def update_training_job(
    job_id: int,
    status: str,
    rows_used: int = 0,
    feature_count: int = 8,
    error_message: Optional[str] = None,
    current_stage: Optional[str] = None,
    completed_stages: Optional[List[str]] = None
):
    """
    Updates status and metrics of a training job.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        if completed_stages is not None:
            comp_json = json.dumps(completed_stages)
            cur.execute("""
                UPDATE training_jobs
                SET status = ?, completed_at = ?, rows_used = ?, feature_count = ?, error_message = ?, current_stage = ?, completed_stages = ?
                WHERE id = ?
            """, (status, now_iso, rows_used, feature_count, error_message, current_stage or status, comp_json, job_id))
        else:
            cur.execute("""
                UPDATE training_jobs
                SET status = ?, completed_at = ?, rows_used = ?, feature_count = ?, error_message = ?
                WHERE id = ?
            """, (status, now_iso, rows_used, feature_count, error_message, job_id))


def register_trained_model(
    station_id: str,
    model_card: Dict[str, Any],
    model_location: str,
    training_started_at: str
) -> Dict[str, Any]:
    """
    Registers a new model version in model_registry:
    1. Archives any existing ACTIVE model for this station.
    2. Inserts new model with status = ACTIVE.
    """
    clean_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    model_id = model_card["model_id"]
    version = model_card.get("version", "v1.0")
    algorithm = model_card.get("algorithm", "Isolation Forest")
    summary = model_card.get("training_summary", {})
    features_json = json.dumps(summary.get("features", []))
    training_rows = summary.get("valid_records", 0)
    threshold = float(summary.get("dynamic_threshold", 0.65))
    contamination = float(summary.get("contamination_rate_pct", 5.0)) / 100.0
    sha256 = model_card.get("sha256", "")
    metrics_json = json.dumps(model_card.get("metrics", {}))

    with get_db() as conn:
        cur = conn.cursor()
        # Archive current active model
        cur.execute("""
            UPDATE model_registry
            SET status = 'ARCHIVED'
            WHERE station_id = ? AND status = 'ACTIVE'
        """, (clean_id,))

        # Insert new active model
        cur.execute("""
            INSERT INTO model_registry (
                station_id, model_id, model_version, model_type, model_location,
                feature_schema, training_rows, threshold, contamination_rate, sha256,
                status, training_started_at, training_completed_at, metrics, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
        """, (
            clean_id, model_id, version, algorithm, str(model_location),
            features_json, training_rows, threshold, contamination, sha256,
            training_started_at, now_iso, metrics_json, now_iso
        ))

    return {
        "station_id": clean_id,
        "model_id": model_id,
        "model_version": version,
        "status": "ACTIVE",
        "threshold": threshold,
        "training_rows": training_rows,
        "model_location": str(model_location)
    }


def get_active_model_record(station_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves the currently ACTIVE model from model_registry for station_id.
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM model_registry
            WHERE station_id = ? AND status = 'ACTIVE'
            ORDER BY id DESC
            LIMIT 1
        """, (clean_id,))
        return cur.fetchone()


def list_station_models(station_id: str) -> List[Dict[str, Any]]:
    """
    Returns all registered model versions for station_id (both ACTIVE and ARCHIVED).
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM model_registry
            WHERE station_id = ?
            ORDER BY id DESC
        """, (clean_id,))
        return cur.fetchall()


def rollback_model_version(station_id: str, target_version: str) -> Dict[str, Any]:
    """
    Rolls back the active model for station_id to target_version:
    1. Validates target version exists.
    2. Archives current active model.
    3. Activates target version.
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, model_id, model_version, model_location FROM model_registry
            WHERE station_id = ? AND model_version = ?
        """, (clean_id, target_version))
        target = cur.fetchone()

        if not target:
            raise ValueError(f"Model version '{target_version}' not found for station '{clean_id}'")

        # Archive active models
        cur.execute("""
            UPDATE model_registry
            SET status = 'ARCHIVED'
            WHERE station_id = ? AND status = 'ACTIVE'
        """, (clean_id,))

        # Activate target version
        cur.execute("""
            UPDATE model_registry
            SET status = 'ACTIVE'
            WHERE id = ?
        """, (target["id"],))

        return {
            "success": True,
            "station_id": clean_id,
            "active_version": target["model_version"],
            "model_id": target["model_id"],
            "message": f"Successfully rolled back {clean_id} active model to version {target_version}"
        }


def list_training_jobs(station_id: str, limit: int = 25) -> List[Dict[str, Any]]:
    """
    Returns historical training jobs for station_id.
    """
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM training_jobs
            WHERE station_id = ?
            ORDER BY id DESC
            LIMIT ?
        """, (clean_id, limit))
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            val = r.get("completed_stages")
            if isinstance(val, str):
                try:
                    r["completed_stages"] = json.loads(val)
                except Exception:
                    r["completed_stages"] = []
        return rows


def update_training_job_stage(job_id: int, current_stage: str, completed_stages: List[str]):
    with get_db() as conn:
        cur = conn.cursor()
        completed_json = json.dumps(completed_stages)
        cur.execute("""
            UPDATE training_jobs
            SET current_stage = ?, completed_stages = ?
            WHERE id = ?
        """, (current_stage, completed_json, job_id))


def get_training_job(job_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM training_jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def ensure_station_exists(station_id: str, station_name: Optional[str] = None, conn: Optional[Any] = None):
    """
    Idempotently ensures a station record exists in the database.
    Prevents foreign key violation crashes when receiving telemetry or injecting faults
    on new, preset, or dynamically provisioned weather stations.
    """
    clean_id = station_id.strip().upper()
    name = station_name or f"{clean_id} Weather Station"
    uname = f"op_{clean_id.lower().replace('-', '_')}"
    pwd_hash = hash_password("sentinel2026")
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    def _execute(c):
        cur = c.cursor()
        if c.is_postgres:
            cur.execute("""
                INSERT INTO stations (
                    station_id, station_name, username, password_hash, access_key,
                    latitude, longitude, elevation, region, status, created_by, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, 'sentinel2026', 17.3850, 78.4867, 500.0, 'General', 'ACTIVE', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (station_id) DO NOTHING;
            """, (clean_id, name, uname, pwd_hash))
        else:
            cur.execute("""
                INSERT OR IGNORE INTO stations (
                    station_id, station_name, username, password_hash, access_key,
                    latitude, longitude, elevation, region, status, created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'sentinel2026', 17.3850, 78.4867, 500.0, 'General', 'ACTIVE', 'system', ?, ?);
            """, (clean_id, name, uname, pwd_hash, now_iso, now_iso))

    if conn is not None:
        _execute(conn)
    else:
        with get_db() as c:
            _execute(c)


def set_active_fault(station_id: str, fault_type: str, offset_val: Optional[float] = None):
    clean_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        ensure_station_exists(clean_id, conn=conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM active_faults WHERE station_id = %s" if conn.is_postgres else "DELETE FROM active_faults WHERE station_id = ?", (clean_id,))
        cur.execute("""
            INSERT INTO active_faults (station_id, fault_type, offset_val, injected_at)
            VALUES (%s, %s, %s, %s)
        """ if conn.is_postgres else """
            INSERT INTO active_faults (station_id, fault_type, offset_val, injected_at)
            VALUES (?, ?, ?, ?)
        """, (clean_id, fault_type, offset_val, now_iso))




def clear_active_fault(station_id: str):
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM active_faults WHERE station_id = ?", (clean_id,))


def clear_all_active_faults() -> int:
    """Clear every synthetic fault used by the deterministic demo lab."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM active_faults")
        return cur.rowcount


def get_active_fault(station_id: str) -> Optional[Dict[str, Any]]:
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM active_faults WHERE station_id = ?", (clean_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def get_all_active_faults() -> Dict[str, Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM active_faults")
        rows = cur.fetchall()
        return {r["station_id"]: dict(r) for r in rows}


import math

def get_station_qc_config(station_id: str) -> Optional[Dict[str, Any]]:
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM station_qc_config WHERE station_id = %s" if conn.is_postgres else "SELECT * FROM station_qc_config WHERE station_id = ?", (clean_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def calibrate_station_qc(station_id: str) -> Optional[Dict[str, Any]]:
    clean_id = station_id.strip().upper()
    
    with get_db() as conn:
        cur = conn.cursor()
        
        # 1. Fetch valid historical data ONLY
        cur.execute(
            "SELECT temperature, humidity, pressure, wind_speed "
            "FROM telemetry "
            "WHERE station_id = %s AND qc_flag = 'VALID'" if conn.is_postgres else
            "SELECT temperature, humidity, pressure, wind_speed "
            "FROM telemetry "
            "WHERE station_id = ? AND qc_flag = 'VALID'", (clean_id,))
        
        rows = cur.fetchall()
        
    if not rows:
        return None
        
    temps = sorted([r["temperature"] for r in rows if r["temperature"] is not None])
    hums = sorted([r["humidity"] for r in rows if r["humidity"] is not None])
    press = sorted([r["pressure"] for r in rows if r["pressure"] is not None])
    winds = sorted([r["wind_speed"] for r in rows if r["wind_speed"] is not None])
    
    if len(temps) == 0:
        return None
        
    def get_percentile(data: List[float], p: float) -> float:
        if not data: return 0.0
        idx = (len(data) - 1) * p
        lower = int(math.floor(idx))
        upper = int(math.ceil(idx))
        if lower == upper:
            return round(data[lower], 2)
        weight = idx - lower
        return round(data[lower] * (1 - weight) + data[upper] * weight, 2)

    temp_min, temp_max = get_percentile(temps, 0.01), get_percentile(temps, 0.99)
    hum_min, hum_max = get_percentile(hums, 0.01), get_percentile(hums, 0.99)
    pres_min, pres_max = get_percentile(press, 0.01), get_percentile(press, 0.99)
    wind_min, wind_max = get_percentile(winds, 0.01), get_percentile(winds, 0.99)

    count = len(temps)
    
    with get_db() as conn:
        cur = conn.cursor()
        
        if conn.is_postgres:
            cur.execute("""
                INSERT INTO station_qc_config (
                    station_id, temperature_normal_min, temperature_normal_max,
                    humidity_normal_min, humidity_normal_max,
                    pressure_normal_min, pressure_normal_max,
                    wind_normal_min, wind_normal_max,
                    calibration_method, calibration_record_count, version, calibrated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (station_id) DO UPDATE SET
                    temperature_normal_min = EXCLUDED.temperature_normal_min,
                    temperature_normal_max = EXCLUDED.temperature_normal_max,
                    humidity_normal_min = EXCLUDED.humidity_normal_min,
                    humidity_normal_max = EXCLUDED.humidity_normal_max,
                    pressure_normal_min = EXCLUDED.pressure_normal_min,
                    pressure_normal_max = EXCLUDED.pressure_normal_max,
                    wind_normal_min = EXCLUDED.wind_normal_min,
                    wind_normal_max = EXCLUDED.wind_normal_max,
                    calibration_method = EXCLUDED.calibration_method,
                    calibration_record_count = EXCLUDED.calibration_record_count,
                    version = station_qc_config.version + 1,
                    calibrated_at = CURRENT_TIMESTAMP
            """, (
                clean_id, temp_min, temp_max, hum_min, hum_max,
                pres_min, pres_max, wind_min, wind_max,
                'HISTORICAL_P01_P99', count, 1
            ))
        else:
            cur.execute("""
                INSERT INTO station_qc_config (
                    station_id, temperature_normal_min, temperature_normal_max,
                    humidity_normal_min, humidity_normal_max,
                    pressure_normal_min, pressure_normal_max,
                    wind_normal_min, wind_normal_max,
                    calibration_method, calibration_record_count, version, calibrated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (station_id) DO UPDATE SET
                    temperature_normal_min = excluded.temperature_normal_min,
                    temperature_normal_max = excluded.temperature_normal_max,
                    humidity_normal_min = excluded.humidity_normal_min,
                    humidity_normal_max = excluded.humidity_normal_max,
                    pressure_normal_min = excluded.pressure_normal_min,
                    pressure_normal_max = excluded.pressure_normal_max,
                    wind_normal_min = excluded.wind_normal_min,
                    wind_normal_max = excluded.wind_normal_max,
                    calibration_method = excluded.calibration_method,
                    calibration_record_count = excluded.calibration_record_count,
                    version = station_qc_config.version + 1,
                    calibrated_at = CURRENT_TIMESTAMP
            """, (
                clean_id, temp_min, temp_max, hum_min, hum_max,
                pres_min, pres_max, wind_min, wind_max,
                'HISTORICAL_P01_P99', count, 1
            ))
            
    return get_station_qc_config(clean_id)


calibrate_station_qc_matrix = calibrate_station_qc


# -----------------------------------------------------------------------------
# Incidents Persistence & Lifecycle Management
# -----------------------------------------------------------------------------

def _format_incident_row(r: Dict[str, Any]) -> Dict[str, Any]:
    for field in ["reason_codes", "recommended_actions", "evidence_ids"]:
        val = r.get(field)
        if isinstance(val, str):
            try:
                r[field] = json.loads(val)
            except Exception:
                r[field] = []
        elif not isinstance(val, list):
            r[field] = []

    val = r.get("evidence_data")
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            r["evidence_data"] = parsed if isinstance(parsed, dict) else {}
        except Exception:
            r["evidence_data"] = {}
    elif not isinstance(val, dict):
        r["evidence_data"] = {}
            
    for dt_field in ["created_at", "updated_at", "adjudicated_at"]:
        if isinstance(r.get(dt_field), datetime.datetime):
            r[dt_field] = r[dt_field].isoformat()
            
    return r


def get_incident(incident_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("SELECT * FROM incidents WHERE id = %s", (incident_id,))
        else:
            cur.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
        row = cur.fetchone()
        if not row:
            return None
        return _format_incident_row(dict(row))


def create_or_update_incident(incident_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    station_id = str(incident_data["station_id"]).strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    with get_db() as conn:
        ensure_station_exists(station_id, incident_data.get("station_name"), conn=conn)
        cur = conn.cursor()

        if conn.is_postgres:
            cur.execute(
                "SELECT * FROM incidents WHERE station_id = %s AND status = 'open' LIMIT 1",
                (station_id,)
            )
        else:
            cur.execute(
                "SELECT * FROM incidents WHERE station_id = ? AND status = 'open' LIMIT 1",
                (station_id,)
            )
        existing = cur.fetchone()
        
        def _json_serial(obj):
            if isinstance(obj, (datetime.datetime, datetime.date)):
                return obj.isoformat()
            if hasattr(obj, '__float__'):
                return float(obj)
            return str(obj)

        reason_codes = json.dumps(incident_data.get("reason_codes", []), default=_json_serial)
        rec_actions = json.dumps(incident_data.get("recommended_actions", []), default=_json_serial)
        evidence_ids = json.dumps(incident_data.get("evidence_ids", []), default=_json_serial)
        evidence_data = json.dumps(incident_data.get("evidence_data", {}), default=_json_serial)
        
        if existing:
            inc_id = existing["id"]
            if conn.is_postgres:
                cur.execute("""
                    UPDATE incidents SET
                        variable = %s,
                        severity = %s,
                        fault_risk = %s,
                        quality_state = %s,
                        reason_codes = %s,
                        explanation = %s,
                        recommended_actions = %s,
                        evidence_ids = %s,
                        evidence_data = %s,
                        normal_streak = 0,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (
                    incident_data.get("variable", "air_temperature"),
                    incident_data.get("severity", "high"),
                    float(incident_data.get("fault_risk", 0.85)),
                    incident_data.get("quality_state", "LOCALIZED_ANOMALY"),
                    reason_codes,
                    incident_data.get("explanation", ""),
                    rec_actions,
                    evidence_ids,
                    evidence_data,
                    inc_id
                ))
            else:
                cur.execute("""
                    UPDATE incidents SET
                        variable = ?,
                        severity = ?,
                        fault_risk = ?,
                        quality_state = ?,
                        reason_codes = ?,
                        explanation = ?,
                        recommended_actions = ?,
                        evidence_ids = ?,
                        evidence_data = ?,
                        normal_streak = 0,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    incident_data.get("variable", "air_temperature"),
                    incident_data.get("severity", "high"),
                    float(incident_data.get("fault_risk", 0.85)),
                    incident_data.get("quality_state", "LOCALIZED_ANOMALY"),
                    reason_codes,
                    incident_data.get("explanation", ""),
                    rec_actions,
                    evidence_ids,
                    evidence_data,
                    now_iso,
                    inc_id
                ))
        else:
            ts_short = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            inc_id = f"INC-{station_id}-{ts_short}"
            
            if conn.is_postgres:
                cur.execute("""
                    INSERT INTO incidents (
                        id, station_id, station_name, variable, severity, fault_risk,
                        quality_state, reason_codes, explanation, recommended_actions,
                        evidence_ids, evidence_data, status, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, (
                    inc_id,
                    station_id,
                    incident_data.get("station_name", station_id),
                    incident_data.get("variable", "air_temperature"),
                    incident_data.get("severity", "high"),
                    float(incident_data.get("fault_risk", 0.85)),
                    incident_data.get("quality_state", "LOCALIZED_ANOMALY"),
                    reason_codes,
                    incident_data.get("explanation", ""),
                    rec_actions,
                    evidence_ids,
                    evidence_data
                ))
            else:
                cur.execute("""
                    INSERT INTO incidents (
                        id, station_id, station_name, variable, severity, fault_risk,
                        quality_state, reason_codes, explanation, recommended_actions,
                        evidence_ids, evidence_data, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
                """, (
                    inc_id,
                    station_id,
                    incident_data.get("station_name", station_id),
                    incident_data.get("variable", "air_temperature"),
                    incident_data.get("severity", "high"),
                    float(incident_data.get("fault_risk", 0.85)),
                    incident_data.get("quality_state", "LOCALIZED_ANOMALY"),
                    reason_codes,
                    incident_data.get("explanation", ""),
                    rec_actions,
                    evidence_ids,
                    evidence_data,
                    now_iso,
                    now_iso
                ))
                
    return get_incident(inc_id)


def resolve_open_incidents_for_station(station_id: str, reason: str = "Telemetry restored to nominal") -> int:
    clean_id = station_id.strip().upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("UPDATE incidents SET normal_streak = normal_streak + 1 WHERE station_id = %s AND status = 'open'", (clean_id,))
            cur.execute("""
                UPDATE incidents SET
                    status = 'resolved',
                    updated_at = CURRENT_TIMESTAMP,
                    action_taken = 'AUTO_RESOLVED'
                WHERE station_id = %s AND status = 'open' AND normal_streak >= 3
            """, (clean_id,))
        else:
            cur.execute("UPDATE incidents SET normal_streak = normal_streak + 1 WHERE station_id = ? AND status = 'open'", (clean_id,))
            cur.execute("""
                UPDATE incidents SET
                    status = 'resolved',
                    updated_at = ?,
                    action_taken = 'AUTO_RESOLVED'
                WHERE station_id = ? AND status = 'open' AND normal_streak >= 3
            """, (now_iso, clean_id))
        return cur.rowcount


def list_incidents(station_id: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
    query = "SELECT * FROM incidents WHERE 1=1"
    params = []
    
    if station_id:
        query += " AND station_id = %s" if IS_POSTGRES else " AND station_id = ?"
        params.append(station_id.strip().upper())
        
    if status:
        query += " AND status = %s" if IS_POSTGRES else " AND status = ?"
        params.append(status.strip().lower())
        
    query += " ORDER BY created_at DESC"
    
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        return [_format_incident_row(dict(r)) for r in rows]


def clear_all_incidents(station_id: Optional[str] = None) -> int:
    """Permanently delete incidents from the database, optionally scoped to one station."""
    with get_db() as conn:
        cur = conn.cursor()
        if station_id:
            cur.execute("DELETE FROM incidents WHERE station_id = ?", (station_id.strip().upper(),))
        else:
            cur.execute("DELETE FROM incidents;")
        return getattr(cur, "rowcount", 0) or 0


# -----------------------------------------------------------------------------
# Field Maintenance & Sensor Calibration Persistence
# -----------------------------------------------------------------------------

DEFAULT_MAINTENANCE_TASKS = [
    {
        "task_key": "chk-1",
        "title": "Clean Multi-Plate Radiation Shield",
        "description": "Remove dirt, algae, insect nests, and debris from the aspirated temperature & humidity sensor housing.",
    },
    {
        "task_key": "chk-2",
        "title": "Inspect Tipping Bucket Rain Gauge",
        "description": "Clear funnel filter of silt, verify tipping bucket pivot balance, and test reed switch closure.",
    },
    {
        "task_key": "chk-3",
        "title": "Check Solar PV Panel & Float Battery Voltage",
        "description": "Clean photovoltaic glass surface, inspect charge controller terminals, and verify float voltage (>12.4V).",
    },
    {
        "task_key": "chk-4",
        "title": "Inspect Barometric Pressure Static Port",
        "description": "Verify Gore-Tex microporous vent filter is free from moisture condensation and atmospheric dust.",
    },
    {
        "task_key": "chk-5",
        "title": "Verify Ultrasonic / Mechanical Anemometer Alignment",
        "description": "Check mast level, confirm true Geographic North offset orientation, and check bearing friction.",
    },
    {
        "task_key": "chk-6",
        "title": "Verify 4G/GSM Cellular Antenna & RSSI",
        "description": "Inspect antenna coaxial water-tight sealing, check signal strength (RSSI > -85 dBm), and test uplink.",
    },
]


def _format_maintenance_task_row(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "task_key": r.get("task_key"),
        "title": r.get("title"),
        "description": r.get("description") or "",
        "done": bool(r.get("done")),
        "completed_by": r.get("completed_by"),
        "completed_at": r.get("completed_at"),
        "updated_at": r.get("updated_at"),
    }


def get_station_maintenance_tasks(station_id: str) -> List[Dict[str, Any]]:
    """Return the persisted maintenance checklist for a station, seeding defaults on first access."""
    clean_id = station_id.strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM maintenance_tasks WHERE station_id = ? ORDER BY id ASC", (clean_id,))
        rows = cur.fetchall()
        if not rows:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            if conn.is_postgres:
                cur.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM maintenance_tasks")
                base_id = int((cur.fetchone() or {}).get("max_id", 0))
                seed_rows = [
                    (base_id + i + 1, clean_id, t["task_key"], t["title"], t["description"], 0, None, None, now_iso)
                    for i, t in enumerate(DEFAULT_MAINTENANCE_TASKS)
                ]
                cur.executemany("""
                    INSERT INTO maintenance_tasks
                        (id, station_id, task_key, title, description, done, completed_by, completed_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (station_id, task_key) DO NOTHING
                """, seed_rows)
            else:
                seed_rows_list: List[tuple] = [
                    (clean_id, t["task_key"], t["title"], t["description"], 0, None, None, now_iso)
                    for t in DEFAULT_MAINTENANCE_TASKS
                ]
                cur.executemany("""
                    INSERT INTO maintenance_tasks
                        (station_id, task_key, title, description, done, completed_by, completed_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(station_id, task_key) DO NOTHING
                """, seed_rows_list)
            cur.execute("SELECT * FROM maintenance_tasks WHERE station_id = ? ORDER BY id ASC", (clean_id,))
            rows = cur.fetchall()
        return [_format_maintenance_task_row(dict(r)) for r in rows]


def set_maintenance_task_state(station_id: str, task_key: str, done: bool, actor: str) -> List[Dict[str, Any]]:
    """Persist a checklist item's completion state and return the refreshed checklist."""
    clean_id = station_id.strip().upper()
    get_station_maintenance_tasks(clean_id)  # ensure defaults are seeded
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE maintenance_tasks SET
                done = ?,
                completed_by = ?,
                completed_at = ?,
                updated_at = ?
            WHERE station_id = ? AND task_key = ?
        """, (1 if done else 0, actor if done else None, now_iso if done else None, now_iso, clean_id, task_key.strip()))
        if cur.rowcount == 0:
            raise ValueError(f"Maintenance task '{task_key}' not found for station '{clean_id}'")
    return get_station_maintenance_tasks(clean_id)


def sign_maintenance_audit(station_id: str, actor: str) -> Dict[str, Any]:
    """Snapshot the current checklist state into an immutable, hash-signed audit record."""
    clean_id = station_id.strip().upper()
    tasks = get_station_maintenance_tasks(clean_id)
    snapshot = json.dumps(tasks, default=str, sort_keys=True)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    signature_hash = hashlib.sha256(f"{clean_id}:{actor}:{now_iso}:{snapshot}".encode()).hexdigest()
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM maintenance_audit")
            new_id = int((cur.fetchone() or {}).get("next_id", 1))
            cur.execute("""
                INSERT INTO maintenance_audit (id, station_id, actor, snapshot, signature_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (new_id, clean_id, actor, snapshot, signature_hash, now_iso))
        else:
            cur.execute("""
                INSERT INTO maintenance_audit (station_id, actor, snapshot, signature_hash, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (clean_id, actor, snapshot, signature_hash, now_iso))
            new_id = cur.lastrowid
    return {
        "id": new_id,
        "station_id": clean_id,
        "actor": actor,
        "signature_hash": signature_hash,
        "created_at": now_iso,
        "tasks_completed": sum(1 for t in tasks if t["done"]),
        "tasks_total": len(tasks),
    }


def list_maintenance_audit(station_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Return the newest-first signed maintenance audit history for a station."""
    clean_id = station_id.strip().upper()
    safe_limit = max(1, min(int(limit), 200))
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, station_id, actor, signature_hash, created_at
            FROM maintenance_audit
            WHERE station_id = ?
            ORDER BY id DESC
            LIMIT ?
        """, (clean_id, safe_limit))
        return [dict(r) for r in cur.fetchall()]


def adjudicate_incident(incident_id: str, action: str, operator_name: str = "Operator") -> Optional[Dict[str, Any]]:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    act = action.strip().upper()
    
    new_status = "resolved"
    quality_override = None
    if act == "ACKNOWLEDGE":
        new_status = "acknowledged"
    elif act == "GENUINE":
        new_status = "resolved"
        quality_override = "GENUINE_EXTREME_CONFIRMED"
    elif act == "REJECT":
        new_status = "resolved"
        quality_override = "REJECTED"
    elif act == "ACCEPT":
        new_status = "closed"
        
    with get_db() as conn:
        cur = conn.cursor()
        if quality_override:
            if conn.is_postgres:
                cur.execute("""
                    UPDATE incidents SET
                        status = %s,
                        quality_state = %s,
                        adjudicated_at = CURRENT_TIMESTAMP,
                        adjudicated_by = %s,
                        action_taken = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (new_status, quality_override, operator_name, act, incident_id))
            else:
                cur.execute("""
                    UPDATE incidents SET
                        status = ?,
                        quality_state = ?,
                        adjudicated_at = ?,
                        adjudicated_by = ?,
                        action_taken = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (new_status, quality_override, now_iso, operator_name, act, now_iso, incident_id))
        else:
            if conn.is_postgres:
                cur.execute("""
                    UPDATE incidents SET
                        status = %s,
                        adjudicated_at = CURRENT_TIMESTAMP,
                        adjudicated_by = %s,
                        action_taken = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (new_status, operator_name, act, incident_id))
            else:
                cur.execute("""
                    UPDATE incidents SET
                        status = ?,
                        adjudicated_at = ?,
                        adjudicated_by = ?,
                        action_taken = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (new_status, now_iso, operator_name, act, now_iso, incident_id))
                
    return get_incident(incident_id)

# -----------------------------------------------------------------------------
# Climatology Model (Harmonic Regression) Access
# -----------------------------------------------------------------------------
def save_station_climatology(station_id: str, parameter: str, coefficients: List[float], robust_sigma: float, observation_count: int, model_version: str) -> None:
    """Persists a fitted harmonic climatology model for a specific parameter."""
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("""
                INSERT INTO station_climatology (station_id, parameter, coefficients, robust_sigma, observation_count, model_version)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (station_id, parameter, json.dumps(coefficients), robust_sigma, observation_count, model_version))
        else:
            cur.execute("""
                INSERT INTO station_climatology (station_id, parameter, coefficients, robust_sigma, observation_count, model_version)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, parameter, json.dumps(coefficients), robust_sigma, observation_count, model_version))

def get_station_climatology(station_id: str, model_version: str) -> Dict[str, Any]:
    """Retrieves all parameter climatologies for a given model version."""
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("""
                SELECT parameter, coefficients, robust_sigma, observation_count
                FROM station_climatology
                WHERE station_id = %s AND model_version = %s
            """, (station_id, model_version))
        else:
            cur.execute("""
                SELECT parameter, coefficients, robust_sigma, observation_count
                FROM station_climatology
                WHERE station_id = ? AND model_version = ?
            """, (station_id, model_version))
            
        rows = cur.fetchall()
        result = {}
        for r in rows:
            result[r["parameter"]] = {
                "coefficients": json.loads(r["coefficients"]),
                "robust_sigma": float(r["robust_sigma"]) if r["robust_sigma"] is not None else 1.0,
                "observation_count": r["observation_count"]
            }
        return result

# -----------------------------------------------------------------------------
# MLOps Monitoring
# -----------------------------------------------------------------------------
def register_retraining_candidate(station_id: str, model_version: str, shadow_score: float, anomaly_rate: float, is_promoted: bool) -> None:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("""
                INSERT INTO retraining_candidates (station_id, model_version, shadow_score, anomaly_rate, is_promoted, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (station_id, model_version, shadow_score, anomaly_rate, is_promoted, now_iso))
        else:
            cur.execute("""
                INSERT INTO retraining_candidates (station_id, model_version, shadow_score, anomaly_rate, is_promoted, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (station_id, model_version, shadow_score, anomaly_rate, is_promoted, now_iso))

def record_drift_metrics(station_id: str, anomaly_rate: float, score_mean: float, score_std: float) -> None:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.cursor()
        if conn.is_postgres:
            cur.execute("""
                INSERT INTO drift_metrics (station_id, anomaly_rate, score_mean, score_std, recorded_at)
                VALUES (%s, %s, %s, %s, %s)
            """, (station_id, anomaly_rate, score_mean, score_std, now_iso))
        else:
            cur.execute("""
                INSERT INTO drift_metrics (station_id, anomaly_rate, score_mean, score_std, recorded_at)
                VALUES (?, ?, ?, ?, ?)
            """, (station_id, anomaly_rate, score_mean, score_std, now_iso))

