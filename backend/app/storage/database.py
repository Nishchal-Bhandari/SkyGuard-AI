import sqlite3
import datetime
from pathlib import Path
from contextlib import contextmanager
from typing import Generator
from backend.app.config import DATABASE_URL, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_NAME
from backend.app.auth.security import hash_password

DB_PATH = Path(DATABASE_URL)

@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager providing a SQLite database connection with row factory
    and enforced foreign key integrity.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """
    Initializes database tables, indexes, and initial admin account idempotently.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Admins Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_login TEXT
            );
        """)
        
        # 2. Weather Stations Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS stations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT UNIQUE NOT NULL COLLATE NOCASE,
                station_name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                elevation REAL DEFAULT 0,
                region TEXT DEFAULT 'General',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_by TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_login TEXT
            );
        """)
        
        # 3. Machine Learning Models Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT NOT NULL,
                model_id TEXT UNIQUE NOT NULL,
                model_version TEXT NOT NULL DEFAULT 'v1.0',
                algorithm TEXT NOT NULL DEFAULT 'IsolationForest',
                dynamic_threshold REAL NOT NULL,
                contamination_rate REAL DEFAULT 0.05,
                sha256_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                trained_at TEXT NOT NULL,
                training_samples INTEGER DEFAULT 0,
                FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
            );
        """)
        
        # 4. Authentication & Security Audit Log Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_username TEXT NOT NULL,
                role TEXT NOT NULL,
                event_type TEXT NOT NULL,
                ip_address TEXT,
                status TEXT NOT NULL,
                details TEXT,
                created_at TEXT NOT NULL
            );
        """)
        
        # Create Indexes for high-frequency queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_stations_station_id ON stations(station_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_stations_username ON stations(username);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_stations_status ON stations(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_models_station_id ON models(station_id);")

        # Ensure access_key column exists in stations table for admin reveal
        try:
            cursor.execute("ALTER TABLE stations ADD COLUMN access_key TEXT DEFAULT 'sentinel2026';")
        except sqlite3.OperationalError:
            pass
        
        # Idempotently seed default admin if none exists
        cursor.execute("SELECT id FROM admins WHERE username = ?", (DEFAULT_ADMIN_USERNAME.lower(),))
        existing_admin = cursor.fetchone()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        if not existing_admin:
            pwd_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
            cursor.execute("""
                INSERT INTO admins (username, password_hash, full_name, status, created_at, updated_at)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?);
            """, (DEFAULT_ADMIN_USERNAME.lower(), pwd_hash, DEFAULT_ADMIN_NAME, now_iso, now_iso))
            print(f"[SQLite] Seeded initial Central Admin account: '{DEFAULT_ADMIN_USERNAME}'")

        # Idempotently seed default Indian AWS fleet presets if stations table is empty
        cursor.execute("SELECT COUNT(*) as count FROM stations")
        station_count = cursor.fetchone()["count"]
        
        if station_count == 0:
            default_presets = [
                ("AWS-07", "Hyderabad Deccan Plateau", "operator_hyd", 17.3850, 78.4867, 542.0, "Deccan Semi-Arid"),
                ("AWS-12", "Mumbai Coastal Radar", "operator_mum", 18.9220, 72.8346, 14.0, "West Coast Maritime"),
                ("AWS-19", "Cherrapunji Hill Observatory", "operator_cherra", 25.2702, 91.7323, 1313.0, "Meghalaya Rainforest"),
                ("AWS-01", "Delhi Urban Meteorological Base", "operator_del", 28.6139, 77.2090, 216.0, "Northern Plains"),
                ("AWS-04", "Bengaluru Tech Plateau", "operator_blr", 12.9716, 77.5946, 920.0, "South Mysore Plateau"),
                ("AWS-21", "Leh High-Altitude Base", "operator_leh", 34.1526, 77.5771, 3500.0, "Trans-Himalayan Cold Desert"),
                ("AWS-15", "Pune Western Ghats Inflow", "operator_pune", 18.5204, 73.8567, 560.0, "Ghats Foothills"),
                ("AWS-09", "Kolkata Delta Marine", "operator_kol", 22.5726, 88.3639, 9.0, "Sundarbans Delta")
            ]
            default_pwd_hash = hash_password("sentinel2026")
            for st_id, st_name, username, lat, lon, elev, region in default_presets:
                cursor.execute("""
                    INSERT INTO stations (
                        station_id, station_name, username, password_hash, latitude, longitude,
                        elevation, region, status, created_by, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'system_init', ?, ?)
                """, (st_id, st_name, username, default_pwd_hash, lat, lon, elev, region, now_iso, now_iso))
            print(f"[SQLite] Auto-seeded {len(default_presets)} default Indian AWS fleet stations.")
