-- ============================================================================
-- Migration 001: Initial Schema for Weather Database
-- Suitable for ECMWF/ERA5 Weather Storage, Anomaly Detection & ML Training
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Source Files Registry
CREATE TABLE IF NOT EXISTS source_files (
    file_id INTEGER PRIMARY KEY AUTOINCREMENT,
    relative_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'netcdf4',
    file_size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    district_folder TEXT NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('accum', 'instant', 'forecast', 'observed', 'unknown')),
    temporal_coverage_start TEXT,
    temporal_coverage_end TEXT,
    grid_dimensions TEXT,
    num_timestamps INTEGER NOT NULL DEFAULT 0,
    num_grid_points INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'partial'))
);

-- 2. Ingestion Runs History
CREATE TABLE IF NOT EXISTS import_runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    source_directory TEXT NOT NULL,
    files_scanned INTEGER NOT NULL DEFAULT 0,
    files_imported INTEGER NOT NULL DEFAULT 0,
    files_skipped INTEGER NOT NULL DEFAULT 0,
    files_failed INTEGER NOT NULL DEFAULT 0,
    total_records_inserted INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'warning', 'failed')),
    log_details TEXT
);

-- 3. Geographic Locations / Districts
CREATE TABLE IF NOT EXISTS locations (
    location_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    district TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'Karnataka',
    country TEXT NOT NULL DEFAULT 'India',
    latitude_min REAL NOT NULL,
    latitude_max REAL NOT NULL,
    longitude_min REAL NOT NULL,
    longitude_max REAL NOT NULL,
    grid_rows INTEGER NOT NULL,
    grid_cols INTEGER NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Spatial Grid Points
CREATE TABLE IF NOT EXISTS grid_points (
    grid_point_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    elevation_m REAL,
    grid_index_i INTEGER NOT NULL,
    grid_index_j INTEGER NOT NULL,
    point_name TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (location_id, latitude, longitude)
);

-- 5. Weather Variables Catalog
CREATE TABLE IF NOT EXISTS variables (
    variable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT NOT NULL UNIQUE,
    standard_name TEXT,
    long_name TEXT,
    grib_param_id INTEGER,
    step_type TEXT NOT NULL DEFAULT 'instant' CHECK (step_type IN ('instant', 'accum', 'mean', 'min', 'max')),
    raw_unit TEXT NOT NULL,
    normalized_unit TEXT NOT NULL,
    conversion_method TEXT NOT NULL,
    conversion_factor REAL DEFAULT 1.0,
    conversion_offset REAL DEFAULT 0.0,
    description TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Long-Form Weather Observations (Complete Audit & Raw Preservation)
CREATE TABLE IF NOT EXISTS observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES source_files(file_id) ON DELETE CASCADE,
    grid_point_id INTEGER NOT NULL REFERENCES grid_points(grid_point_id) ON DELETE CASCADE,
    variable_id INTEGER NOT NULL REFERENCES variables(variable_id) ON DELETE RESTRICT,
    valid_time_utc TEXT NOT NULL,
    timestamp_epoch INTEGER NOT NULL,
    raw_value REAL NOT NULL,
    raw_unit TEXT NOT NULL,
    normalized_value REAL,
    normalized_unit TEXT,
    conversion_method TEXT,
    data_quality_flag INTEGER NOT NULL DEFAULT 0 CHECK (data_quality_flag IN (0, 1, 2, 3)),
    quality_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (grid_point_id, valid_time_utc, variable_id)
);

-- 7. High-Performance Tabular Weather Records (Instant & Accum Consolidated for ML)
CREATE TABLE IF NOT EXISTS tabular_weather_records (
    record_id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_point_id INTEGER NOT NULL REFERENCES grid_points(grid_point_id) ON DELETE CASCADE,
    valid_time_utc TEXT NOT NULL,
    timestamp_epoch INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    t2m_raw_k REAL,
    t2m_deg_c REAL,
    d2m_raw_k REAL,
    d2m_deg_c REAL,
    msl_raw_pa REAL,
    msl_hpa REAL,
    tp_raw_m REAL,
    tp_mm REAL,
    relative_humidity_pct REAL,
    dew_point_depression_c REAL,
    quality_flag INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (grid_point_id, valid_time_utc)
);

-- 8. Data Quality Audits & Anomalies
CREATE TABLE IF NOT EXISTS data_quality_issues (
    issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES source_files(file_id) ON DELETE SET NULL,
    grid_point_id INTEGER REFERENCES grid_points(grid_point_id) ON DELETE SET NULL,
    variable_id INTEGER REFERENCES variables(variable_id) ON DELETE SET NULL,
    valid_time_utc TEXT,
    rule_name TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
    raw_value REAL,
    expected_range TEXT,
    description TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Derived Feature Catalog
CREATE TABLE IF NOT EXISTS derived_features (
    feature_id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_name TEXT NOT NULL UNIQUE,
    feature_group TEXT NOT NULL CHECK (feature_group IN ('temporal', 'physical', 'lag', 'rolling', 'spatial', 'rate_of_change')),
    base_variables TEXT,
    window_hours INTEGER,
    formula_or_method TEXT NOT NULL,
    description TEXT
);

-- 10. ML Training Datasets Registry
CREATE TABLE IF NOT EXISTS ml_training_datasets (
    dataset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_name TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL,
    source_date_start TEXT NOT NULL,
    source_date_end TEXT NOT NULL,
    train_split_end TEXT NOT NULL,
    val_split_end TEXT NOT NULL,
    test_split_end TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    column_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    feature_config_json TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    export_csv_path TEXT,
    export_parquet_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. ML Dataset Splits
CREATE TABLE IF NOT EXISTS ml_dataset_splits (
    split_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES ml_training_datasets(dataset_id) ON DELETE CASCADE,
    split_name TEXT NOT NULL CHECK (split_name IN ('train', 'validation', 'test')),
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    file_path_csv TEXT,
    file_path_parquet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. Anomaly Events / Ground Truth
CREATE TABLE IF NOT EXISTS anomaly_events (
    anomaly_id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_point_id INTEGER REFERENCES grid_points(grid_point_id) ON DELETE SET NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT NOT NULL,
    variable_id INTEGER REFERENCES variables(variable_id) ON DELETE SET NULL,
    anomaly_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MODERATE', 'SEVERE', 'EXTREME')),
    magnitude REAL,
    z_score REAL,
    detection_method TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 13. Model Training Metadata
CREATE TABLE IF NOT EXISTS model_metadata (
    model_id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    model_type TEXT NOT NULL,
    dataset_id INTEGER REFERENCES ml_training_datasets(dataset_id) ON DELETE SET NULL,
    target_variable TEXT,
    hyperparameters_json TEXT,
    metrics_json TEXT,
    artifact_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
