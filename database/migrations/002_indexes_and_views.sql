-- ============================================================================
-- Migration 002: Optimized Indexes & Unified Analytics Views
-- ============================================================================

-- Indexes for Long-Form Observations
CREATE INDEX IF NOT EXISTS idx_obs_grid_time ON observations (grid_point_id, valid_time_utc);
CREATE INDEX IF NOT EXISTS idx_obs_var_time ON observations (variable_id, valid_time_utc);
CREATE INDEX IF NOT EXISTS idx_obs_time ON observations (valid_time_utc);
CREATE INDEX IF NOT EXISTS idx_obs_file_id ON observations (file_id);
CREATE INDEX IF NOT EXISTS idx_obs_quality ON observations (data_quality_flag);

-- Indexes for Tabular Weather Records
CREATE INDEX IF NOT EXISTS idx_tab_grid_time ON tabular_weather_records (grid_point_id, valid_time_utc);
CREATE INDEX IF NOT EXISTS idx_tab_time ON tabular_weather_records (valid_time_utc);
CREATE INDEX IF NOT EXISTS idx_tab_ymd ON tabular_weather_records (year, month, day);
CREATE INDEX IF NOT EXISTS idx_tab_epoch ON tabular_weather_records (timestamp_epoch);

-- Indexes for Spatial Lookups
CREATE INDEX IF NOT EXISTS idx_grid_lat_lon ON grid_points (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_grid_location ON grid_points (location_id);

-- Indexes for Quality Audits
CREATE INDEX IF NOT EXISTS idx_quality_rule ON data_quality_issues (rule_name, severity);
CREATE INDEX IF NOT EXISTS idx_quality_time ON data_quality_issues (valid_time_utc);

-- Indexes for Anomaly Events
CREATE INDEX IF NOT EXISTS idx_anomaly_time ON anomaly_events (start_time_utc, end_time_utc);
CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_events (anomaly_type, severity);

-- Unified Analytics & Research View
CREATE VIEW IF NOT EXISTS v_weather_observations_detail AS
SELECT 
    t.record_id,
    l.district,
    l.name AS location_name,
    g.grid_point_id,
    g.latitude,
    g.longitude,
    g.grid_index_i,
    g.grid_index_j,
    t.valid_time_utc,
    t.timestamp_epoch,
    t.year,
    t.month,
    t.day,
    t.hour,
    t.t2m_raw_k,
    t.t2m_deg_c,
    t.d2m_raw_k,
    t.d2m_deg_c,
    t.msl_raw_pa,
    t.msl_hpa,
    t.tp_raw_m,
    t.tp_mm,
    t.relative_humidity_pct,
    t.dew_point_depression_c,
    t.quality_flag
FROM tabular_weather_records t
JOIN grid_points g ON t.grid_point_id = g.grid_point_id
JOIN locations l ON g.location_id = l.location_id;

-- Summary Aggregates View (Daily Aggregations per District)
CREATE VIEW IF NOT EXISTS v_daily_district_summary AS
SELECT 
    l.district,
    t.year,
    t.month,
    t.day,
    COUNT(DISTINCT g.grid_point_id) AS active_grid_points,
    ROUND(AVG(t.t2m_deg_c), 2) AS mean_temp_c,
    ROUND(MIN(t.t2m_deg_c), 2) AS min_temp_c,
    ROUND(MAX(t.t2m_deg_c), 2) AS max_temp_c,
    ROUND(AVG(t.relative_humidity_pct), 2) AS mean_humidity_pct,
    ROUND(AVG(t.msl_hpa), 2) AS mean_pressure_hpa,
    ROUND(SUM(t.tp_mm) / COUNT(DISTINCT g.grid_point_id), 2) AS avg_total_precip_mm,
    ROUND(MAX(t.tp_mm), 2) AS max_point_precip_mm
FROM tabular_weather_records t
JOIN grid_points g ON t.grid_point_id = g.grid_point_id
JOIN locations l ON g.location_id = l.location_id
GROUP BY l.district, t.year, t.month, t.day;
