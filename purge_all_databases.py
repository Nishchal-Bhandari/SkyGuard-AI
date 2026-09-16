import os
import sys
from pathlib import Path
import sqlite3
import datetime

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend.app.config import DATABASE_URL, IS_POSTGRES, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_NAME
from backend.app.auth.security import hash_password

now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
pwd_hash = hash_password(DEFAULT_ADMIN_PASSWORD)

print("=" * 60)
print("PURGING ALL SKYGUARD-AI DATA ACROSS POSTGRESQL & SQLITE")
print("=" * 60)

# 1. Purge PostgreSQL if configured
if IS_POSTGRES:
    try:
        import psycopg2
        print(f"[PostgreSQL] Connecting to: {DATABASE_URL[:45]}...")
        pg_conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        pg_cur = pg_conn.cursor()
        
        tables_to_clear = [
            "telemetry",
            "incidents",
            "active_faults",
            "station_qc_config",
            "training_jobs",
            "model_registry",
            "models",
            "auth_audit_logs",
            "stations"
        ]
        
        for table in tables_to_clear:
            try:
                pg_cur.execute(f"TRUNCATE TABLE {table} CASCADE;")
                print(f"[PostgreSQL] Truncated {table}")
            except Exception as e:
                pg_conn.rollback()
                try:
                    pg_cur.execute(f"DELETE FROM {table};")
                    print(f"[PostgreSQL] Deleted all rows from {table}")
                except Exception as e2:
                    print(f"[PostgreSQL] Note on {table}: {e2}")
        
        # Ensure only 1 clean admin exists
        pg_cur.execute("DELETE FROM admins;")
        pg_cur.execute("""
            INSERT INTO admins (username, password_hash, full_name, status, created_at, updated_at)
            VALUES (%s, %s, %s, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        """, (DEFAULT_ADMIN_USERNAME.lower(), pwd_hash, DEFAULT_ADMIN_NAME))
        pg_conn.commit()
        print(f"[PostgreSQL] Re-seeded clean admin: {DEFAULT_ADMIN_USERNAME}")
        
        pg_cur.execute("SELECT COUNT(*) FROM stations;")
        print(f"[PostgreSQL] Final Stations Count: {pg_cur.fetchone()[0]}")
        pg_cur.execute("SELECT COUNT(*) FROM incidents;")
        print(f"[PostgreSQL] Final Incidents Count: {pg_cur.fetchone()[0]}")
        pg_conn.close()
    except Exception as e:
        print(f"[PostgreSQL Error]: {e}")

# 2. Purge SQLite
sqlite_path = ROOT / "backend" / "data" / "skyguard.db"
if sqlite_path.exists():
    sq_conn = sqlite3.connect(str(sqlite_path))
    sq_cur = sq_conn.cursor()
    sq_tables = [
        "telemetry",
        "incidents",
        "active_faults",
        "station_qc_config",
        "training_jobs",
        "model_registry",
        "models",
        "auth_audit_logs",
        "stations"
    ]
    for table in sq_tables:
        try:
            sq_cur.execute(f"DELETE FROM {table};")
            print(f"[SQLite] Deleted all rows from {table}")
        except Exception as e:
            print(f"[SQLite] Note on {table}: {e}")
    
    sq_cur.execute("DELETE FROM admins;")
    sq_cur.execute("""
        INSERT INTO admins (username, password_hash, full_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?);
    """, (DEFAULT_ADMIN_USERNAME.lower(), pwd_hash, DEFAULT_ADMIN_NAME, now_iso, now_iso))
    sq_conn.commit()
    print(f"[SQLite] Re-seeded clean admin: {DEFAULT_ADMIN_USERNAME}")
    print(f"[SQLite] Final Stations Count: {sq_cur.execute('SELECT COUNT(*) FROM stations').fetchone()[0]}")
    print(f"[SQLite] Final Incidents Count: {sq_cur.execute('SELECT COUNT(*) FROM incidents').fetchone()[0]}")
    sq_conn.close()

# 3. Clean local model artifacts
models_dir = ROOT / "ml" / "models"
if models_dir.exists():
    for f in models_dir.glob("*.*"):
        try:
            f.unlink()
            print(f"[ML Models] Removed {f.name}")
        except Exception as e:
            pass

print("=" * 60)
print("DATABASE & ARTIFACTS PURGE COMPLETE: ZERO STATIONS, ZERO INCIDENTS")
print("=" * 60)
