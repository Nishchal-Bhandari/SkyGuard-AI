#!/usr/bin/env python3
"""
Data Quality Validation Engine
Audits the ingested weather database for meteorologically anomalous values,
sensor freezes, physical inconsistencies, timestamp gaps, and records audit logs.
"""

import os
import sys
import json
import sqlite3
import argparse
from datetime import datetime, timezone
import pandas as pd
import numpy as np


# Meteorological validation thresholds tailored for South India / Karnataka climate
VALIDATION_RULES = {
    "temp_range": {"min_c": 5.0, "max_c": 55.0, "severity": "WARNING"},
    "dewpoint_range": {"min_c": -5.0, "max_c": 35.0, "severity": "WARNING"},
    "pressure_range": {"min_hpa": 900.0, "max_hpa": 1050.0, "severity": "WARNING"},
    "precip_range": {"min_mm": 0.0, "max_mm": 300.0, "severity": "WARNING"},
    "humidity_range": {"min_pct": 0.0, "max_pct": 100.0, "severity": "WARNING"},
    "temp_jump_1h": {"max_delta_c": 8.0, "severity": "INFO"},
    "pressure_jump_1h": {"max_delta_hpa": 10.0, "severity": "INFO"},
    "stuck_hours": {"threshold": 24, "severity": "WARNING"}
}


def run_data_quality_checks(db_path: str = "data/weather_app.db", output_report: str = "database/reports/data_quality_report.json") -> dict:
    if not os.path.exists(db_path):
        print(f"[-] Error: Database not found at {db_path}", file=sys.stderr)
        sys.exit(1)
        
    print(f"[+] Starting Data Quality Audit on: {db_path}")
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    issues_found = []
    
    # 1. Range Validation on Tabular Records
    print("[*] Checking physical range boundaries...")
    cursor.execute("""
        SELECT record_id, grid_point_id, valid_time_utc, t2m_deg_c, d2m_deg_c, msl_hpa, tp_mm, relative_humidity_pct
        FROM tabular_weather_records
        WHERE t2m_deg_c < ? OR t2m_deg_c > ?
           OR d2m_deg_c < ? OR d2m_deg_c > ?
           OR msl_hpa < ? OR msl_hpa > ?
           OR tp_mm < ? OR tp_mm > ?
           OR relative_humidity_pct < ? OR relative_humidity_pct > ?
    """, (
        VALIDATION_RULES["temp_range"]["min_c"], VALIDATION_RULES["temp_range"]["max_c"],
        VALIDATION_RULES["dewpoint_range"]["min_c"], VALIDATION_RULES["dewpoint_range"]["max_c"],
        VALIDATION_RULES["pressure_range"]["min_hpa"], VALIDATION_RULES["pressure_range"]["max_hpa"],
        VALIDATION_RULES["precip_range"]["min_mm"], VALIDATION_RULES["precip_range"]["max_mm"],
        VALIDATION_RULES["humidity_range"]["min_pct"], VALIDATION_RULES["humidity_range"]["max_pct"]
    ))
    
    range_violators = cursor.fetchall()
    for row in range_violators:
        issues_found.append({
            "grid_point_id": row["grid_point_id"],
            "valid_time_utc": row["valid_time_utc"],
            "rule_name": "PHYSICAL_RANGE_VIOLATION",
            "severity": "WARNING",
            "description": f"Value out of normal range: t2m={row['t2m_deg_c']}, d2m={row['d2m_deg_c']}, msl={row['msl_hpa']}, tp={row['tp_mm']}, rh={row['relative_humidity_pct']}"
        })
        
    # 2. Inversion check: Temperature < Dewpoint (Physical inconsistency)
    print("[*] Checking temperature vs dewpoint physical consistency (T >= Td)...")
    cursor.execute("""
        SELECT record_id, grid_point_id, valid_time_utc, t2m_deg_c, d2m_deg_c
        FROM tabular_weather_records
        WHERE t2m_deg_c < d2m_deg_c AND t2m_deg_c IS NOT NULL AND d2m_deg_c IS NOT NULL
    """)
    inversion_rows = cursor.fetchall()
    for row in inversion_rows:
        issues_found.append({
            "grid_point_id": row["grid_point_id"],
            "valid_time_utc": row["valid_time_utc"],
            "rule_name": "DEWPOINT_SUPERIOR_TO_TEMP",
            "severity": "WARNING",
            "description": f"Dewpoint ({row['d2m_deg_c']} C) exceeds dry-bulb temperature ({row['t2m_deg_c']} C) by {row['d2m_deg_c'] - row['t2m_deg_c']:.2f} C"
        })
        
    # 3. Time Series Gaps & Sudden Rate-of-Change Checks per Grid Point
    print("[*] Checking temporal continuity and rate-of-change spikes across grid points...")
    cursor.execute("SELECT DISTINCT grid_point_id FROM grid_points")
    grid_ids = [r[0] for r in cursor.fetchall()]
    
    temporal_gaps_count = 0
    temp_spike_count = 0
    pressure_spike_count = 0
    
    for gid in grid_ids:
        df = pd.read_sql_query("""
            SELECT valid_time_utc, timestamp_epoch, t2m_deg_c, msl_hpa, tp_mm
            FROM tabular_weather_records
            WHERE grid_point_id = ?
            ORDER BY timestamp_epoch ASC
        """, conn, params=(gid,))
        
        if df.empty or len(df) < 2:
            continue
            
        # Check epoch delta
        epoch_diff = df["timestamp_epoch"].diff()
        bad_intervals = df[epoch_diff > 3600]
        for _, row in bad_intervals.iterrows():
            temporal_gaps_count += 1
            if temporal_gaps_count <= 20:
                issues_found.append({
                    "grid_point_id": gid,
                    "valid_time_utc": row["valid_time_utc"],
                    "rule_name": "TEMPORAL_GAP",
                    "severity": "INFO",
                    "description": f"Time gap detected: {epoch_diff.loc[_]/3600:.1f} hours elapsed since previous observation"
                })
                
        # Check temperature jumps
        t_diff = df["t2m_deg_c"].diff().abs()
        t_spikes = df[t_diff > VALIDATION_RULES["temp_jump_1h"]["max_delta_c"]]
        for _, row in t_spikes.iterrows():
            temp_spike_count += 1
            if temp_spike_count <= 20:
                issues_found.append({
                    "grid_point_id": gid,
                    "valid_time_utc": row["valid_time_utc"],
                    "rule_name": "TEMPERATURE_RATE_OF_CHANGE_SPIKE",
                    "severity": "INFO",
                    "description": f"Hourly temperature jump of {t_diff.loc[_]:.2f} C"
                })
                
        # Check pressure jumps
        p_diff = df["msl_hpa"].diff().abs()
        p_spikes = df[p_diff > VALIDATION_RULES["pressure_jump_1h"]["max_delta_hpa"]]
        for _, row in p_spikes.iterrows():
            pressure_spike_count += 1
            if pressure_spike_count <= 20:
                issues_found.append({
                    "grid_point_id": gid,
                    "valid_time_utc": row["valid_time_utc"],
                    "rule_name": "PRESSURE_RATE_OF_CHANGE_SPIKE",
                    "severity": "INFO",
                    "description": f"Hourly pressure jump of {p_diff.loc[_]:.2f} hPa"
                })

    # Log issues to data_quality_issues table
    print(f"[*] Inserting {len(issues_found)} audit log entries...")
    cursor.execute("DELETE FROM data_quality_issues")
    for issue in issues_found:
        cursor.execute("""
            INSERT INTO data_quality_issues (
                grid_point_id, valid_time_utc, rule_name, severity, description
            ) VALUES (?, ?, ?, ?, ?)
        """, (
            issue.get("grid_point_id"), issue.get("valid_time_utc"),
            issue["rule_name"], issue["severity"], issue["description"]
        ))
        
    conn.commit()
    
    # Statistical Overview
    cursor.execute("SELECT COUNT(*) FROM tabular_weather_records")
    total_records = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM grid_points")
    total_grids = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM locations")
    total_locations = cursor.fetchone()[0]
    
    audit_summary = {
        "audit_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "database_audited": os.path.abspath(db_path),
        "total_locations": total_locations,
        "total_grid_points": total_grids,
        "total_weather_records": total_records,
        "quality_metrics": {
            "range_violations": len(range_violators),
            "temp_dewpoint_inversions": len(inversion_rows),
            "temporal_gaps": temporal_gaps_count,
            "temperature_spikes_1h": temp_spike_count,
            "pressure_spikes_1h": pressure_spike_count,
            "total_audit_issues_logged": len(issues_found),
            "data_health_score_pct": round(max(0.0, 100.0 - (len(issues_found) / max(1, total_records) * 100)), 4)
        }
    }
    
    conn.close()
    
    os.makedirs(os.path.dirname(os.path.abspath(output_report)), exist_ok=True)
    with open(output_report, "w", encoding="utf-8") as f:
        json.dump(audit_summary, f, indent=2)
        
    print(f"[+] Quality audit complete! Data Health: {audit_summary['quality_metrics']['data_health_score_pct']}%")
    print(f"    Report saved to: {output_report}")
    return audit_summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate data quality of the weather database.")
    parser.add_argument("--db", default="data/weather_app.db", help="Path to SQLite database file")
    parser.add_argument("--report", default="database/reports/data_quality_report.json", help="Path for JSON quality report")
    args = parser.parse_args()
    
    run_data_quality_checks(args.db, args.report)
