-- SkyGuard-AI — SQLite Database Schema Definition
-- Version: 2.0.0

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 1. Administrators Table
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

-- 2. Weather Stations Table
CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT UNIQUE NOT NULL COLLATE NOCASE,
    station_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
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

-- 3. Machine Learning Models Table
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

-- 4. Authentication & Security Audit Log Table
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stations_station_id ON stations(station_id);
CREATE INDEX IF NOT EXISTS idx_stations_username ON stations(username);
CREATE INDEX IF NOT EXISTS idx_stations_status ON stations(status);
CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
CREATE INDEX IF NOT EXISTS idx_models_station_id ON models(station_id);
