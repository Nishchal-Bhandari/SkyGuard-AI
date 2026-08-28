# Relational Database Schema & Data Models

## 1. Tables Overview

| Table Name | Description | Key Constraints & Indexes |
|---|---|---|
| `source_files` | Registry of all scanned NetCDF files | `file_id` (PK), `sha256` (UNIQUE), `relative_path` (UNIQUE) |
| `import_runs` | Audit history of ingestion runs | `run_id` (PK) |
| `locations` | District / regional geographic entities | `location_id` (PK), `name` (UNIQUE) |
| `grid_points` | Discovered spatial grid coordinates | `grid_point_id` (PK), `(location_id, latitude, longitude)` (UNIQUE) |
| `variables` | Meteorological variable catalog & unit definitions | `variable_id` (PK), `short_name` (UNIQUE) |
| `observations` | Long-form observation storage with raw & normalized values | `observation_id` (PK), `(grid_point_id, valid_time_utc, variable_id)` (UNIQUE) |
| `tabular_weather_records` | Consolidated wide format for ML feature engineering | `record_id` (PK), `(grid_point_id, valid_time_utc)` (UNIQUE) |
| `data_quality_issues` | Audit log of anomalous values, jumps, and gaps | `issue_id` (PK), indexed on `(rule_name, severity)` |
| `derived_features` | Catalog of mathematical transformations and features | `feature_id` (PK), `feature_name` (UNIQUE) |
| `ml_training_datasets` | Versioned registry of ML training datasets | `dataset_id` (PK), `dataset_name` (UNIQUE), `config_hash` |
| `ml_dataset_splits` | Train, validation, and test split partitions | `split_id` (PK), `(dataset_id, split_name)` |
| `anomaly_events` | Detected or ground-truth meteorological anomalies | `anomaly_id` (PK), `(start_time_utc, end_time_utc)` |
| `model_metadata` | Machine learning model run artifacts & hyperparameters | `model_id` (PK) |

---

## 2. Entity Relationship Diagram

```
[locations] 1 --- * [grid_points] 1 --- * [observations] * --- 1 [variables]
                         |                      |
                         |                      * --- 1 [source_files]
                         *
             [tabular_weather_records]
                         |
                         *
             [ml_training_datasets] 1 --- * [ml_dataset_splits]
```

---

## 3. Database Views
- **`v_weather_observations_detail`**: Joins `tabular_weather_records` with `grid_points` and `locations` to provide complete geographic context, timestamps, raw and normalized units in a single queryable view.
- **`v_daily_district_summary`**: Computes aggregated daily metrics (mean/min/max temperature, mean relative humidity, mean sea level pressure, total precipitation) per district.
