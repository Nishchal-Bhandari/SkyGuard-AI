-- ============================================================================
-- SkyGuard-AI — Cloud PostgreSQL & TimescaleDB Migration Script
-- Version: 2.1.0
-- Target: Cloud PostgreSQL 14+ / TimescaleDB (Logical Multi-Tenancy by station_id)
-- ============================================================================

-- 1. Optional TimescaleDB Extension (Enables hypertable time-series optimizations if installed)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension not available on this instance; proceeding with standard PostgreSQL partitioning & indexes.';
END $$;

-- 2. Administrators Table
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

-- 3. Weather Stations Table (Authoritative registry of physical AWS units)
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

-- 4. High-Throughput Station Telemetry Table
-- Note: Uses composite primary key (id, timestamp) for TimescaleDB hypertable compatibility
-- grid_point stores "lat,lon" for gridded spatial CSVs; empty string for single-point stations.
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
    raw_payload JSONB,
    qc_flag VARCHAR(32) DEFAULT 'RAW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, timestamp)
);

-- 5. Time-Series Hypertable Configuration (Optional TimescaleDB optimization)
DO $$
BEGIN
    PERFORM create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE);
    RAISE NOTICE 'TimescaleDB hypertable created on telemetry(timestamp).';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipped create_hypertable (standard PostgreSQL table active).';
END $$;

-- 6. Indexes for Zero-Latency Station Lookups and Historical Range Queries
CREATE INDEX IF NOT EXISTS idx_telemetry_station_id ON telemetry(station_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp DESC);
-- Unique constraint: (station_id, timestamp, grid_point) supports both single-point
-- stations (grid_point='') and gridded spatial datasets (grid_point='lat,lon').
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station_id, timestamp, grid_point);

-- 7. Training Jobs Audit & Execution Ledger
CREATE TABLE IF NOT EXISTS training_jobs (
    id SERIAL PRIMARY KEY,
    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rows_used INTEGER DEFAULT 0,
    feature_count INTEGER DEFAULT 8,
    model_version VARCHAR(32),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_station ON training_jobs(station_id, created_at DESC);

-- 8. Station-Adaptive Model Governance Registry
CREATE TABLE IF NOT EXISTS model_registry (
    id SERIAL PRIMARY KEY,
    station_id VARCHAR(32) NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
    model_id VARCHAR(64) UNIQUE NOT NULL,
    model_version VARCHAR(32) NOT NULL,
    model_type VARCHAR(64) NOT NULL DEFAULT 'IsolationForest',
    model_location VARCHAR(255) NOT NULL,
    feature_schema JSONB,
    training_rows INTEGER NOT NULL,
    threshold DOUBLE PRECISION NOT NULL,
    contamination_rate DOUBLE PRECISION DEFAULT 0.05,
    sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    training_started_at TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    metrics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_registry_station ON model_registry(station_id, status);
CREATE INDEX IF NOT EXISTS idx_model_registry_version ON model_registry(station_id, model_version);

-- 9. Security Audit Trail
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

CREATE INDEX IF NOT EXISTS idx_auth_audit_actor ON auth_audit_logs(actor_username);
