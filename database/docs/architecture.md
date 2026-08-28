# SkyGuard-AI Database & Data Engineering Architecture

## 1. Overview
The **SkyGuard-AI Local Database Pipeline** provides a high-performance, fault-tolerant, and reproducible meteorological data management layer built specifically for ECMWF/ERA5 atmospheric reanalysis NetCDF4 datasets covering Karnataka districts.

It enables:
- **Raw Fidelity Preservation:** Strict preservation of original GRIB values, units, coordinates, and precision.
- **Dynamic Variable Ingestion:** Automatic extraction and registration of continuous meteorological streams (`instant` vs `accum`).
- **Data Quality Auditing:** Automated detection of sensor freezes, thermodynamic inversions ($T < T_d$), rate-of-change spikes, and time gaps.
- **Machine Learning Ready:** Domain-engineered features (relative humidity, vapor pressure deficit, lags, rolling statistics, seasonal cycles) and time-aware chronological splits to guarantee zero future-data leakage.

```
                   +------------------------------------+
                   |     NetCDF4 Datasets (*.nc)        |
                   |  (Datasets/<district_folder>/*.nc) |
                   +-----------------+------------------+
                                     |
                                     v
                        [ inspect_datasets.py ]
                                     |
                                     v
                  +--------------------------------------+
                  |   dataset_inspection_report.json/md  |
                  +--------------------------------------+
                                     |
                                     v
                         [ ingest_datasets.py ]
                                     |
          +--------------------------+--------------------------+
          |                                                     |
          v                                                     v
+-----------------------+                             +--------------------+
|  observations table   |                             | tabular_weather_   |
| (long-form audit log) |                             |     records        |
+-----------------------+                             +---------+----------+
                                                                |
                                                                v
                                                   [ validate_data_quality.py ]
                                                                |
                                                                v
                                                   [ prepare_training_data.py ]
                                                                |
                                                                v
                                                   [ export_training_data.py ]
                                                                |
                                         +----------------------+----------------------+
                                         |                                             |
                                         v                                             v
                           +----------------------------+                +-------------------------------+
                           | database/exports/*.parquet |                | database/exports/*.csv        |
                           +----------------------------+                +-------------------------------+
```

---

## 2. Storage Engine & Concurrency Design
- **Engine:** SQLite 3.x
- **Path:** `data/weather_app.db`
- **Journal Mode:** Write-Ahead Logging (`WAL`)
- **Foreign Keys:** Enabled (`PRAGMA foreign_keys = ON;`)
- **Busy Timeout:** 30,000 ms (`PRAGMA busy_timeout = 30000;`)
- **Cache Size:** 64 MB (`PRAGMA cache_size = -64000;`)
- **Synchronous Mode:** `NORMAL` (optimal balance of data safety and high write throughput)

---

## 3. Idempotency & Resiliency
- Every NetCDF file is hashed via SHA-256 upon scan.
- Ingestion queries `source_files` table with the SHA-256 hash. If present, the file is safely skipped.
- Transactions are committed per-file. An interrupted run can be safely resumed without corrupting previously ingested files or creating duplicate rows.
