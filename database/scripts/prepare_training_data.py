#!/usr/bin/env python3
"""
Machine Learning Dataset Preparation Engine
Generates rich, time-aware engineered features, statistical rollups, physical meteorological
indicators, and strictly chronological train/validation/test splits with zero future leakage.
"""

import os
import sys
import json
import sqlite3
import hashlib
import argparse
from datetime import datetime, timezone
import pandas as pd
import numpy as np


def compute_vpd(temp_c: pd.Series, rh_pct: pd.Series) -> pd.Series:
    """Compute Vapor Pressure Deficit (VPD in kPa)."""
    # Saturated vapor pressure (es in kPa)
    es = 0.61078 * np.exp((17.27 * temp_c) / (temp_c + 237.3))
    # Actual vapor pressure (ea in kPa)
    ea = es * (rh_pct / 100.0)
    return (es - ea).clip(lower=0.0)


def build_ml_features(df: pd.DataFrame) -> pd.DataFrame:
    """Construct domain-specific meteorological features with strict temporal ordering."""
    df = df.sort_values(["grid_point_id", "timestamp_epoch"]).reset_index(drop=True)
    
    # 1. Cyclical and Temporal Features
    hours = df["hour"].values
    doy = pd.to_datetime(df["valid_time_utc"]).dt.dayofyear.values
    
    df["hour_sin"] = np.sin(2 * np.pi * hours / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hours / 24.0)
    df["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)
    df["is_summer"] = df["month"].isin([3, 4, 5]).astype(int)
    df["is_winter"] = df["month"].isin([12, 1, 2]).astype(int)
    
    # 2. Physical Meteorological Features
    df["vpd_kpa"] = compute_vpd(df["t2m_deg_c"], df["relative_humidity_pct"])
    
    # Grouped operations per grid point to avoid boundary leakage
    feature_dfs = []
    for gid, group in df.groupby("grid_point_id", sort=False):
        g = group.copy()
        
        # 3. Lags
        for lag in [1, 2, 3, 6, 12, 24]:
            g[f"t2m_lag_{lag}h"] = g["t2m_deg_c"].shift(lag)
        for lag in [1, 3, 6]:
            g[f"msl_lag_{lag}h"] = g["msl_hpa"].shift(lag)
            g[f"tp_lag_{lag}h"] = g["tp_mm"].shift(lag)
            g[f"d2m_lag_{lag}h"] = g["d2m_deg_c"].shift(lag)
            
        # 4. Rate-of-Change (Differences)
        g["t2m_diff_1h"] = g["t2m_deg_c"].diff(1)
        g["t2m_diff_3h"] = g["t2m_deg_c"].diff(3)
        g["msl_diff_1h"] = g["msl_hpa"].diff(1)
        g["msl_diff_3h"] = g["msl_hpa"].diff(3)
        g["rh_diff_3h"] = g["relative_humidity_pct"].diff(3)
        
        # 5. Rolling Statistics (Past Windows Only)
        g["t2m_roll_mean_6h"] = g["t2m_deg_c"].rolling(6, min_periods=1).mean()
        g["t2m_roll_std_6h"] = g["t2m_deg_c"].rolling(6, min_periods=1).std().fillna(0.0)
        g["t2m_roll_min_24h"] = g["t2m_deg_c"].rolling(24, min_periods=1).min()
        g["t2m_roll_max_24h"] = g["t2m_deg_c"].rolling(24, min_periods=1).max()
        
        g["msl_roll_mean_6h"] = g["msl_hpa"].rolling(6, min_periods=1).mean()
        g["msl_roll_std_6h"] = g["msl_hpa"].rolling(6, min_periods=1).std().fillna(0.0)
        
        g["tp_roll_sum_3h"] = g["tp_mm"].rolling(3, min_periods=1).sum()
        g["tp_roll_sum_6h"] = g["tp_mm"].rolling(6, min_periods=1).sum()
        g["tp_roll_sum_24h"] = g["tp_mm"].rolling(24, min_periods=1).sum()
        
        # 6. Anomaly & Extreme Event Target Indicators
        g["target_heatwave_flag"] = (g["t2m_deg_c"] > 38.0).astype(int)
        g["target_heavy_rain_flag"] = (g["tp_mm"] > 15.0).astype(int)
        g["target_extreme_rain_flag"] = (g["tp_mm"] > 35.0).astype(int)
        g["target_pressure_drop_flag"] = (g["msl_diff_3h"] < -3.0).astype(int)
        
        feature_dfs.append(g)
        
    result_df = pd.concat(feature_dfs, ignore_index=True)
    # Drop warm-up rows where 24h lags are NaN
    result_df = result_df.dropna(subset=["t2m_lag_24h"]).reset_index(drop=True)
    return result_df


def prepare_ml_dataset(
    db_path: str = "data/weather_app.db",
    dataset_name: str = "karnataka_weather_ml_v1",
    version: str = "1.0.0",
    train_pct: float = 0.70,
    val_pct: float = 0.15
) -> dict:
    if not os.path.exists(db_path):
        print(f"[-] Error: Database not found at {db_path}", file=sys.stderr)
        sys.exit(1)
        
    print(f"[+] Extracting tabular records from {db_path}...")
    conn = sqlite3.connect(db_path, timeout=60.0)
    
    query = """
        SELECT 
            t.record_id,
            l.district,
            g.grid_point_id,
            g.latitude,
            g.longitude,
            t.valid_time_utc,
            t.timestamp_epoch,
            t.year,
            t.month,
            t.day,
            t.hour,
            t.t2m_deg_c,
            t.d2m_deg_c,
            t.msl_hpa,
            t.tp_mm,
            t.relative_humidity_pct,
            t.dew_point_depression_c,
            t.quality_flag
        FROM tabular_weather_records t
        JOIN grid_points g ON t.grid_point_id = g.grid_point_id
        JOIN locations l ON g.location_id = l.location_id
        WHERE t.t2m_deg_c IS NOT NULL AND t.tp_mm IS NOT NULL
        ORDER BY t.timestamp_epoch ASC, g.grid_point_id ASC
    """
    raw_df = pd.read_sql_query(query, conn)
    print(f"[+] Loaded {len(raw_df):,} raw base rows.")
    
    print("[*] Generating ML feature transformations (lags, rolling stats, physical variables)...")
    ml_df = build_ml_features(raw_df)
    print(f"[+] Generated dataset shape: {ml_df.shape} ({ml_df.shape[0]:,} rows, {ml_df.shape[1]} columns)")
    
    # Chronological Time Splitting
    unique_timestamps = sorted(ml_df["timestamp_epoch"].unique())
    n_times = len(unique_timestamps)
    
    train_idx_end = int(n_times * train_pct)
    val_idx_end = int(n_times * (train_pct + val_pct))
    
    train_t_end = unique_timestamps[train_idx_end - 1]
    val_t_end = unique_timestamps[val_idx_end - 1]
    test_t_end = unique_timestamps[-1]
    
    train_df = ml_df[ml_df["timestamp_epoch"] <= train_t_end].copy()
    val_df = ml_df[(ml_df["timestamp_epoch"] > train_t_end) & (ml_df["timestamp_epoch"] <= val_t_end)].copy()
    test_df = ml_df[ml_df["timestamp_epoch"] > val_t_end].copy()
    
    train_start_iso = train_df["valid_time_utc"].min()
    train_end_iso = train_df["valid_time_utc"].max()
    val_start_iso = val_df["valid_time_utc"].min()
    val_end_iso = val_df["valid_time_utc"].max()
    test_start_iso = test_df["valid_time_utc"].min()
    test_end_iso = test_df["valid_time_utc"].max()
    
    print(f"[+] Dataset Split Summary:")
    print(f"    Train: {len(train_df):,} rows ({train_start_iso} -> {train_end_iso})")
    print(f"    Val:   {len(val_df):,} rows ({val_start_iso} -> {val_end_iso})")
    print(f"    Test:  {len(test_df):,} rows ({test_start_iso} -> {test_end_iso})")
    
    # Config and Hash
    feature_cols = [c for c in ml_df.columns if c not in ["record_id", "district", "valid_time_utc", "timestamp_epoch"]]
    config_dict = {
        "dataset_name": dataset_name,
        "version": version,
        "features": feature_cols,
        "train_pct": train_pct,
        "val_pct": val_pct,
        "num_features": len(feature_cols),
        "total_rows": len(ml_df)
    }
    config_str = json.dumps(config_dict, sort_keys=True)
    config_hash = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
    
    # Store registration in database
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO ml_training_datasets (
            dataset_name, version, source_date_start, source_date_end,
            train_split_end, val_split_end, test_split_end,
            row_count, column_count, missing_count, feature_config_json, config_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dataset_name) DO UPDATE SET
            version = excluded.version,
            source_date_start = excluded.source_date_start,
            source_date_end = excluded.source_date_end,
            train_split_end = excluded.train_split_end,
            val_split_end = excluded.val_split_end,
            test_split_end = excluded.test_split_end,
            row_count = excluded.row_count,
            column_count = excluded.column_count,
            missing_count = excluded.missing_count,
            feature_config_json = excluded.feature_config_json,
            config_hash = excluded.config_hash
    """, (
        dataset_name, version, train_start_iso, test_end_iso,
        train_end_iso, val_end_iso, test_end_iso,
        len(ml_df), len(ml_df.columns), int(ml_df.isna().sum().sum()),
        config_str, config_hash
    ))
    cursor.execute("SELECT dataset_id FROM ml_training_datasets WHERE dataset_name = ?", (dataset_name,))
    dataset_id = cursor.fetchone()[0]
    
    # Save splits metadata
    cursor.execute("DELETE FROM ml_dataset_splits WHERE dataset_id = ?", (dataset_id,))
    splits_info = [
        (dataset_id, "train", train_start_iso, train_end_iso, len(train_df)),
        (dataset_id, "validation", val_start_iso, val_end_iso, len(val_df)),
        (dataset_id, "test", test_start_iso, test_end_iso, len(test_df))
    ]
    cursor.executemany("""
        INSERT INTO ml_dataset_splits (
            dataset_id, split_name, start_time_utc, end_time_utc, row_count
        ) VALUES (?, ?, ?, ?, ?)
    """, splits_info)
    
    conn.commit()
    conn.close()
    
    result = {
        "dataset_id": dataset_id,
        "dataset_name": dataset_name,
        "version": version,
        "config_hash": config_hash,
        "total_rows": len(ml_df),
        "total_columns": len(ml_df.columns),
        "features": feature_cols,
        "splits": {
            "train": {"rows": len(train_df), "start": train_start_iso, "end": train_end_iso},
            "validation": {"rows": len(val_df), "start": val_start_iso, "end": val_end_iso},
            "test": {"rows": len(test_df), "start": test_start_iso, "end": test_end_iso}
        }
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare ML dataset with rich features and temporal splits.")
    parser.add_argument("--db", default="data/weather_app.db", help="Path to SQLite database file")
    parser.add_argument("--name", default="karnataka_weather_ml_v1", help="Dataset identifier name")
    parser.add_argument("--version", default="1.0.0", help="Semantic version string")
    args = parser.parse_args()
    
    prepare_ml_dataset(args.db, args.name, args.version)
