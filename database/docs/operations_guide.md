# Operations & CLI Guide

## 1. Inspect Datasets
Scan any directory containing NetCDF dataset files, calculate SHA-256 checksums, and generate inspection reports:
```bash
python database/scripts/inspect_datasets.py --path Datasets --output-dir database/reports
```

## 2. Ingest Datasets into SQLite
Perform transactional, chunked, and idempotent ingestion into SQLite:
```bash
python database/scripts/ingest_datasets.py --path Datasets --db data/weather_app.db
```

## 3. Validate Data Quality
Execute data-quality rules, check for range violations, temperature inversions, rate-of-change spikes, and log audit issues:
```bash
python database/scripts/validate_data_quality.py --db data/weather_app.db --report database/reports/data_quality_report.json
```

## 4. Prepare Machine Learning Datasets
Generate domain-specific features (relative humidity, vapor pressure deficit, lags, rolling statistics, rate of change) with strict time-aware splitting:
```bash
python database/scripts/prepare_training_data.py --db data/weather_app.db --name karnataka_weather_ml_v1 --version 1.0.0
```

## 5. Export Datasets to Parquet & CSV
Export prepared datasets to high-performance Apache Parquet and CSV files:
```bash
python database/scripts/export_training_data.py --db data/weather_app.db --export-dir database/exports --name karnataka_weather_ml_v1
```

## 6. Backup & Restore Database
Create an online crash-consistent backup with PRAGMA integrity verification:
```bash
# Create backup
python database/scripts/backup_restore.py backup --db data/weather_app.db --dir database/backups

# List backups
python database/scripts/backup_restore.py list --dir database/backups

# Restore from backup
python database/scripts/backup_restore.py restore --file database/backups/weather_app_backup_<TIMESTAMP>.db --target data/weather_app.db
```

## 7. Run Test Suite
Execute the entire test suite:
```bash
python database/tests/run_all_tests.py
```
