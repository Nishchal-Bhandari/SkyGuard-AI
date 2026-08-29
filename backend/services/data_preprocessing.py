"""
SkyGuard AI — Data Preprocessing Service
Step 1: CSV Validation & Step 2: Data Preprocessing

Handles column normalization, validation, chronological sorting, duplicate removal,
hardware corrupted value scrubbing (-999, 9999), physical sanity bounds, and missing value interpolation.
"""

import io
import logging
from pathlib import Path
from typing import Dict, Tuple, Union, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Canonical Column Mappings
COLUMN_ALIASES = {
    "timestamp": [
        "timestamp", "Timestamp", "TIMESTAMP",
        "date_time", "datetime", "Date_Time", "DATE_TIME",
        "time", "Time", "date", "Date"
    ],
    "temperature": [
        "temperature", "Temperature", "TEMPERATURE",
        "temp", "Temp", "temperature_c", "temp_c", "Temp_C", "temp_celsius"
    ],
    "pressure": [
        "pressure", "Pressure", "PRESSURE",
        "pres", "Pres", "pressure_hpa", "pres_hpa", "Pres_hPa", "barometer"
    ],
    "humidity": [
        "humidity", "Humidity", "HUMIDITY",
        "hum", "Hum", "humidity_pct", "hum_pct", "Hum_pct", "relative_humidity"
    ]
}

# Physical Sanity Bounds
PHYSICAL_BOUNDS = {
    "temperature": (-50.0, 60.0),   # °C
    "pressure": (700.0, 1100.0),    # hPa
    "humidity": (0.0, 100.0)        # %
}

# Known Hardware Error Flag Sentinels
CORRUPTED_SENTINELS = [-9999, -999, 999, 9999, -9999.0, -999.0, 999.0, 9999.0]


def normalize_columns(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """
    Identifies and renames columns matching known weather parameter variations.
    Raises ValueError if required parameters cannot be mapped.
    """
    column_mapping = {}
    found_canonicals = {}

    for col in df.columns:
        clean_col = str(col).strip()
        for canonical, aliases in COLUMN_ALIASES.items():
            if clean_col in aliases or clean_col.lower() in [a.lower() for a in aliases]:
                if canonical not in found_canonicals:
                    column_mapping[col] = canonical
                    found_canonicals[canonical] = col

    required_canonical = ["timestamp", "temperature", "pressure", "humidity"]
    missing = [req for req in required_canonical if req not in found_canonicals]

    if missing:
        raise ValueError(
            f"CSV Validation Error: Missing required column(s): {missing}. "
            f"Detected columns in file: {list(df.columns)}. "
            f"Expected aliases for missing columns: {[COLUMN_ALIASES[m] for m in missing]}"
        )

    df_renamed = df.rename(columns=column_mapping).copy()
    return df_renamed, column_mapping


def validate_and_preprocess_csv(
    source: Union[str, Path, io.BytesIO, io.StringIO, pd.DataFrame]
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Full validation and preprocessing pipeline for uploaded station CSV datasets.
    
    Returns:
        (df_cleaned, summary_metrics)
    """
    # 1. Read CSV source
    if isinstance(source, pd.DataFrame):
        df_raw = source.copy()
    elif isinstance(source, (str, Path)):
        try:
            df_raw = pd.read_csv(source)
        except Exception as e:
            raise ValueError(f"Failed to read CSV file at '{source}': {str(e)}")
    elif isinstance(source, (io.BytesIO, io.StringIO)):
        try:
            df_raw = pd.read_csv(source)
        except Exception as e:
            raise ValueError(f"Failed to parse uploaded CSV bytes: {str(e)}")
    else:
        raise ValueError("Unsupported data source provided to CSV preprocessor.")

    raw_record_count = len(df_raw)
    if raw_record_count == 0:
        raise ValueError("Uploaded CSV file is empty (0 records).")

    # 2. Normalize and check columns
    df, col_mapping = normalize_columns(df_raw)

    # 3. Parse timestamp and handle invalid dates
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    nat_count = df["timestamp"].isna().sum()
    df = df.dropna(subset=["timestamp"])

    # 4. Sort chronologically and drop duplicate timestamps
    df = df.sort_values(by="timestamp").reset_index(drop=True)
    before_dedup = len(df)
    df = df.drop_duplicates(subset=["timestamp"], keep="first").reset_index(drop=True)
    duplicate_count = before_dedup - len(df)

    # 5. Convert numeric columns and scrub hardware flags / physical OOB
    scrubbed_sentinels_count = 0
    for param in ["temperature", "pressure", "humidity"]:
        df[param] = pd.to_numeric(df[param], errors="coerce")

        # Replace hardware sentinels (-999, 9999) with NaN
        sentinel_mask = df[param].isin(CORRUPTED_SENTINELS)
        scrubbed_sentinels_count += int(sentinel_mask.sum())
        df.loc[sentinel_mask, param] = np.nan

        # Enforce physical sanity bounds
        min_bound, max_bound = PHYSICAL_BOUNDS[param]
        oob_mask = (df[param] < min_bound) | (df[param] > max_bound)
        scrubbed_sentinels_count += int(oob_mask.sum())
        df.loc[oob_mask, param] = np.nan

    # 6. Interpolate small missing gaps (linear interpolation up to limit=3)
    for param in ["temperature", "pressure", "humidity"]:
        df[param] = df[param].interpolate(method="linear", limit=3)
        # Forward fill & backward fill edge cases
        df[param] = df[param].ffill().bfill()

    # Drop any remaining unfillable NaN rows
    df_cleaned = df.dropna(subset=["temperature", "pressure", "humidity"]).reset_index(drop=True)
    final_record_count = len(df_cleaned)

    summary = {
        "raw_records": raw_record_count,
        "invalid_timestamps_removed": int(nat_count),
        "duplicates_removed": int(duplicate_count),
        "corrupted_values_scrubbed": int(scrubbed_sentinels_count),
        "final_cleaned_records": final_record_count,
        "column_mapping": {v: k for k, v in col_mapping.items() if v in ["timestamp", "temperature", "pressure", "humidity"]}
    }

    logger.info(
        f"CSV Validation & Preprocessing complete: {raw_record_count} -> {final_record_count} valid records."
    )
    return df_cleaned, summary
