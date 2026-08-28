#!/usr/bin/env python3
"""
Weather Dataset Ingestion Engine
Performs robust, idempotent, transaction-safe batch ingestion of NetCDF datasets
into SQLite (data/weather_app.db) with raw data preservation and unit normalization.
"""

import os
import sys
import glob
import json
import sqlite3
import argparse
from datetime import datetime, timezone
import netCDF4 as nc
import numpy as np


# Magnus formula constants for Relative Humidity calculation from T and Td (in Celsius)
A_MAGNUS = 17.27
B_MAGNUS = 237.7


def compute_relative_humidity(temp_c: float, dewpoint_c: float) -> float:
    """Calculate Relative Humidity (%) using the Magnus-Tetens approximation."""
    if temp_c is None or dewpoint_c is None or np.isnan(temp_c) or np.isnan(dewpoint_c):
        return None
    try:
        gamma_t = (A_MAGNUS * temp_c) / (B_MAGNUS + temp_c)
        gamma_td = (A_MAGNUS * dewpoint_c) / (B_MAGNUS + dewpoint_c)
        rh = 100.0 * np.exp(gamma_td - gamma_t)
        return float(np.clip(rh, 0.0, 100.0))
    except Exception:
        return None


def get_db_connection(db_path: str) -> sqlite3.Connection:
    """Initialize SQLite connection with WAL mode and robust concurrency settings."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    conn.execute("PRAGMA cache_size = -64000;")  # 64MB cache
    conn.row_factory = sqlite3.Row
    return conn


def apply_migrations(conn: sqlite3.Connection, migrations_dir: str = "database/migrations"):
    """Apply SQL migrations in sequence."""
    migration_files = sorted(glob.glob(os.path.join(migrations_dir, "*.sql")))
    cursor = conn.cursor()
    for mfile in migration_files:
        with open(mfile, "r", encoding="utf-8") as f:
            sql_script = f.read()
        cursor.executescript(sql_script)
    conn.commit()


def register_variables(conn: sqlite3.Connection):
    """Seed / ensure standard meteorological variables are registered."""
    vars_def = [
        (
            "t2m", "air_temperature", "2 metre temperature", 167, "instant",
            "K", "degC", "celsius = kelvin - 273.15", 1.0, -273.15,
            "Ambient temperature at 2 meters above ground surface"
        ),
        (
            "d2m", "dew_point_temperature", "2 metre dewpoint temperature", 168, "instant",
            "K", "degC", "celsius = kelvin - 273.15", 1.0, -273.15,
            "Dewpoint temperature at 2 meters above ground surface"
        ),
        (
            "msl", "air_pressure_at_mean_sea_level", "Mean sea level pressure", 151, "instant",
            "Pa", "hPa", "hpa = pa / 100.0", 0.01, 0.0,
            "Atmospheric pressure normalized to mean sea level"
        ),
        (
            "tp", "precipitation_amount", "Total precipitation", 228, "accum",
            "m", "mm", "mm = m * 1000.0", 1000.0, 0.0,
            "Accumulated liquid and frozen water reaching the surface over accumulation interval"
        )
    ]
    cursor = conn.cursor()
    for v in vars_def:
        cursor.execute("""
            INSERT OR IGNORE INTO variables (
                short_name, standard_name, long_name, grib_param_id, step_type,
                raw_unit, normalized_unit, conversion_method, conversion_factor, conversion_offset, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, v)
    conn.commit()


def get_or_create_location(conn: sqlite3.Connection, district_folder: str, lats: list, lons: list) -> int:
    """Register or retrieve location ID based on district and bounding box."""
    district_clean = district_folder.split("_202")[0].replace("_", " ").title()
    location_name = district_folder
    
    cursor = conn.cursor()
    cursor.execute("SELECT location_id FROM locations WHERE name = ?", (location_name,))
    row = cursor.fetchone()
    if row:
        return row[0]
        
    cursor.execute("""
        INSERT INTO locations (
            name, district, state, country, latitude_min, latitude_max, longitude_min, longitude_max,
            grid_rows, grid_cols, metadata_json
        ) VALUES (?, ?, 'Karnataka', 'India', ?, ?, ?, ?, ?, ?, ?)
    """, (
        location_name, district_clean, min(lats), max(lats), min(lons), max(lons),
        len(lats), len(lons), json.dumps({"source_folder": district_folder})
    ))
    conn.commit()
    return cursor.lastrowid


def ensure_grid_points(conn: sqlite3.Connection, location_id: int, lats: list, lons: list) -> dict:
    """Ensure all grid points exist and return mapping (lat, lon) -> grid_point_id."""
    cursor = conn.cursor()
    mapping = {}
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            cursor.execute("""
                SELECT grid_point_id FROM grid_points
                WHERE location_id = ? AND ABS(latitude - ?) < 1e-4 AND ABS(longitude - ?) < 1e-4
            """, (location_id, lat, lon))
            row = cursor.fetchone()
            if row:
                mapping[(round(lat, 4), round(lon, 4))] = row[0]
            else:
                cursor.execute("""
                    INSERT INTO grid_points (
                        location_id, latitude, longitude, grid_index_i, grid_index_j, point_name
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (location_id, lat, lon, i, j, f"Grid_{location_id}_{i}_{j}"))
                mapping[(round(lat, 4), round(lon, 4))] = cursor.lastrowid
    conn.commit()
    return mapping


def ingest_all_datasets(data_path: str = "Datasets", db_path: str = "data/weather_app.db") -> dict:
    """Main ingestion coordinator function."""
    if not os.path.exists(data_path):
        for alt in ["Datasets", "docs/datasets", "datasets"]:
            if os.path.exists(alt):
                data_path = alt
                break
                
    print(f"[+] Starting Ingestion Pipeline")
    print(f"    Source Data: {os.path.abspath(data_path)}")
    print(f"    Database:    {os.path.abspath(db_path)}")
    
    conn = get_db_connection(db_path)
    apply_migrations(conn)
    register_variables(conn)
    
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO import_runs (source_directory, status)
        VALUES (?, 'running')
    """, (os.path.abspath(data_path),))
    run_id = cursor.lastrowid
    conn.commit()
    
    # Query variable metadata IDs
    cursor.execute("SELECT short_name, variable_id, raw_unit, normalized_unit, conversion_factor, conversion_offset, conversion_method FROM variables")
    var_meta = {row["short_name"]: dict(row) for row in cursor.fetchall()}
    
    nc_files = sorted(glob.glob(os.path.join(data_path, "**", "*.nc"), recursive=True))
    files_scanned = len(nc_files)
    files_imported = 0
    files_skipped = 0
    files_failed = 0
    total_records = 0
    
    # Import files grouped by district to allow consolidation
    for fpath in nc_files:
        try:
            filename = os.path.basename(fpath)
            parts = os.path.normpath(fpath).split(os.sep)
            district_folder = parts[-2] if len(parts) >= 2 else "root"
            file_size = os.path.getsize(fpath)
            
            # Compute hash for idempotency check
            import hashlib
            hasher = hashlib.sha256()
            with open(fpath, "rb") as f:
                while chunk := f.read(65536):
                    hasher.update(chunk)
            sha256 = hasher.hexdigest()
            
            # Check if file already ingested
            cursor.execute("SELECT file_id FROM source_files WHERE sha256 = ?", (sha256,))
            existing_file = cursor.fetchone()
            if existing_file:
                print(f"[*] Skipping already ingested file: {filename} ({district_folder})")
                files_skipped += 1
                continue
                
            print(f"[+] Ingesting: {filename} ({district_folder})...")
            
            ds = nc.Dataset(fpath, "r")
            valid_time_var = ds.variables.get("valid_time")
            timestamps = valid_time_var[:] if valid_time_var is not None else []
            lats = [float(x) for x in ds.variables["latitude"][:]]
            lons = [float(x) for x in ds.variables["longitude"][:]]
            
            time_start_iso = datetime.fromtimestamp(int(timestamps[0]), tz=timezone.utc).isoformat() if len(timestamps) else None
            time_end_iso = datetime.fromtimestamp(int(timestamps[-1]), tz=timezone.utc).isoformat() if len(timestamps) else None
            step_type = "accum" if "accum" in filename else ("instant" if "instant" in filename else "unknown")
            
            location_id = get_or_create_location(conn, district_folder, lats, lons)
            grid_mapping = ensure_grid_points(conn, location_id, lats, lons)
            
            # Register file
            cursor.execute("""
                INSERT INTO source_files (
                    relative_path, filename, format, file_size_bytes, sha256, district_folder,
                    step_type, temporal_coverage_start, temporal_coverage_end, grid_dimensions,
                    num_timestamps, num_grid_points, metadata_json, status
                ) VALUES (?, ?, 'netcdf4', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
            """, (
                os.path.relpath(fpath), filename, file_size, sha256, district_folder,
                step_type, time_start_iso, time_end_iso, f"{len(lats)}x{len(lons)}",
                len(timestamps), len(lats) * len(lons),
                json.dumps({k: str(ds.getncattr(k)) for k in ds.ncattrs()})
            ))
            file_id = cursor.lastrowid
            
            data_vars = [k for k in ds.variables.keys() if k not in ["number", "valid_time", "latitude", "longitude", "expver"]]
            
            obs_batch = []
            tab_batch = []
            
            # Extract arrays
            extracted_arrays = {vname: ds.variables[vname][:] for vname in data_vars}
            
            for t_idx, t_val in enumerate(timestamps):
                t_sec = int(t_val)
                dt = datetime.fromtimestamp(t_sec, tz=timezone.utc)
                dt_iso = dt.isoformat()
                year, month, day, hour = dt.year, dt.month, dt.day, dt.hour
                
                for i, lat in enumerate(lats):
                    for j, lon in enumerate(lons):
                        grid_id = grid_mapping[(round(lat, 4), round(lon, 4))]
                        
                        # Populate long-form observations
                        for vname in data_vars:
                            raw_val = float(extracted_arrays[vname][t_idx, i, j])
                            if np.isnan(raw_val):
                                continue
                                
                            v_info = var_meta.get(vname)
                            if v_info:
                                norm_val = (raw_val * v_info["conversion_factor"]) + v_info["conversion_offset"]
                                if vname == "tp" and norm_val < 0:
                                    norm_val = 0.0  # clamp negative precip noise
                                obs_batch.append((
                                    file_id, grid_id, v_info["variable_id"], dt_iso, t_sec,
                                    raw_val, v_info["raw_unit"], norm_val, v_info["normalized_unit"],
                                    v_info["conversion_method"], 0, None
                                ))
                        
                        # Populate wide / tabular weather record
                        if "t2m" in extracted_arrays and "d2m" in extracted_arrays and "msl" in extracted_arrays:
                            t2m_k = float(extracted_arrays["t2m"][t_idx, i, j])
                            d2m_k = float(extracted_arrays["d2m"][t_idx, i, j])
                            msl_pa = float(extracted_arrays["msl"][t_idx, i, j])
                            
                            t2m_c = t2m_k - 273.15
                            d2m_c = d2m_k - 273.15
                            msl_hpa = msl_pa / 100.0
                            rh = compute_relative_humidity(t2m_c, d2m_c)
                            dpd = t2m_c - d2m_c
                            
                            tab_batch.append((
                                grid_id, dt_iso, t_sec, year, month, day, hour,
                                t2m_k, t2m_c, d2m_k, d2m_c, msl_pa, msl_hpa,
                                None, None, rh, dpd, 0
                            ))
                        elif "tp" in extracted_arrays:
                            tp_m = float(extracted_arrays["tp"][t_idx, i, j])
                            tp_mm = max(0.0, tp_m * 1000.0)
                            tab_batch.append((
                                grid_id, dt_iso, t_sec, year, month, day, hour,
                                None, None, None, None, None, None,
                                tp_m, tp_mm, None, None, 0
                            ))
            
            ds.close()
            
            # Execute batch insert for observations
            if obs_batch:
                cursor.executemany("""
                    INSERT OR REPLACE INTO observations (
                        file_id, grid_point_id, variable_id, valid_time_utc, timestamp_epoch,
                        raw_value, raw_unit, normalized_value, normalized_unit,
                        conversion_method, data_quality_flag, quality_notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, obs_batch)
                total_records += len(obs_batch)
                
            # Upsert wide table records
            if tab_batch:
                if step_type == "instant":
                    cursor.executemany("""
                        INSERT INTO tabular_weather_records (
                            grid_point_id, valid_time_utc, timestamp_epoch, year, month, day, hour,
                            t2m_raw_k, t2m_deg_c, d2m_raw_k, d2m_deg_c, msl_raw_pa, msl_hpa,
                            tp_raw_m, tp_mm, relative_humidity_pct, dew_point_depression_c, quality_flag
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(grid_point_id, valid_time_utc) DO UPDATE SET
                            t2m_raw_k = excluded.t2m_raw_k,
                            t2m_deg_c = excluded.t2m_deg_c,
                            d2m_raw_k = excluded.d2m_raw_k,
                            d2m_deg_c = excluded.d2m_deg_c,
                            msl_raw_pa = excluded.msl_raw_pa,
                            msl_hpa = excluded.msl_hpa,
                            relative_humidity_pct = excluded.relative_humidity_pct,
                            dew_point_depression_c = excluded.dew_point_depression_c
                    """, tab_batch)
                elif step_type == "accum":
                    cursor.executemany("""
                        INSERT INTO tabular_weather_records (
                            grid_point_id, valid_time_utc, timestamp_epoch, year, month, day, hour,
                            t2m_raw_k, t2m_deg_c, d2m_raw_k, d2m_deg_c, msl_raw_pa, msl_hpa,
                            tp_raw_m, tp_mm, relative_humidity_pct, dew_point_depression_c, quality_flag
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(grid_point_id, valid_time_utc) DO UPDATE SET
                            tp_raw_m = excluded.tp_raw_m,
                            tp_mm = excluded.tp_mm
                    """, tab_batch)
                    
            conn.commit()
            files_imported += 1
            print(f"    -> Successfully inserted {len(obs_batch):,} observations from {filename}")
            
        except Exception as e:
            conn.rollback()
            files_failed += 1
            print(f"[-] Error ingesting file {fpath}: {e}", file=sys.stderr)
            
    # Finalize import run record
    status_str = "success" if files_failed == 0 else ("warning" if files_imported > 0 else "failed")
    cursor.execute("""
        UPDATE import_runs
        SET finished_at = datetime('now'),
            files_scanned = ?,
            files_imported = ?,
            files_skipped = ?,
            files_failed = ?,
            total_records_inserted = ?,
            status = ?,
            log_details = ?
        WHERE run_id = ?
    """, (
        files_scanned, files_imported, files_skipped, files_failed, total_records,
        status_str, f"Completed import run. Imported: {files_imported}, Skipped: {files_skipped}, Failed: {files_failed}",
        run_id
    ))
    conn.commit()
    conn.close()
    
    result = {
        "files_scanned": files_scanned,
        "files_imported": files_imported,
        "files_skipped": files_skipped,
        "files_failed": files_failed,
        "total_records_inserted": total_records,
        "status": status_str
    }
    print(f"\n[+] Ingestion Complete! Summary: {result}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest weather NetCDF datasets into SQLite database.")
    parser.add_argument("--path", default="Datasets", help="Directory path to scan for datasets")
    parser.add_argument("--db", default="data/weather_app.db", help="Path to SQLite database file")
    args = parser.parse_args()
    
    ingest_all_datasets(args.path, args.db)
