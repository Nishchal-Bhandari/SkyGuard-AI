"""Versioned additive migrations. Credential erasure is intentionally irreversible.

Existing password hashes remain usable and are upgraded to Argon2id on login.
Take a database backup before upgrade; never restore plaintext credential columns.
"""


def migrate(conn):
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    cur.execute("SELECT version FROM schema_migrations")
    versions = {r["version"] for r in cur.fetchall()}
    if 1 not in versions:
        cur.execute("UPDATE stations SET access_key = '' WHERE access_key IS NOT NULL")
        if conn.is_postgres:
            cur.execute("ALTER TABLE stations ALTER COLUMN access_key SET DEFAULT ''")
            cur.execute("ALTER TABLE stations ADD CONSTRAINT station_no_plaintext CHECK (access_key IS NULL OR access_key = '')")
        else:
            for action in ("INSERT", "UPDATE"):
                cur.execute(f"""CREATE TRIGGER IF NOT EXISTS no_plaintext_{action.lower()}
                    BEFORE {action} ON stations WHEN NEW.access_key IS NOT NULL AND NEW.access_key != ''
                    BEGIN SELECT RAISE(ABORT, 'plaintext credentials forbidden'); END""")
        cur.execute("INSERT INTO schema_migrations(version) VALUES (1)")
    if 2 not in versions:
        cur.execute("""CREATE TABLE IF NOT EXISTS observations (
            observation_id TEXT PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(station_id),
            source_timestamp TEXT NOT NULL, received_at TEXT NOT NULL, source TEXT NOT NULL,
            payload_hash TEXT NOT NULL, raw_data TEXT NOT NULL, assessment_data TEXT NOT NULL,
            UNIQUE(station_id, source_timestamp, source))""")
        cur.execute("CREATE INDEX IF NOT EXISTS observations_station_time ON observations(station_id, source_timestamp)")
        cur.execute("""CREATE TABLE IF NOT EXISTS observation_quarantine (
            id TEXT PRIMARY KEY, station_id TEXT NOT NULL, received_at TEXT NOT NULL,
            reason TEXT NOT NULL, raw_data TEXT NOT NULL)""")
        cur.execute("CREATE TABLE IF NOT EXISTS station_pipeline_state (station_id TEXT PRIMARY KEY REFERENCES stations(station_id), source_timestamp TEXT NOT NULL, normal_streak INTEGER NOT NULL DEFAULT 0)")
        cur.execute("CREATE TABLE IF NOT EXISTS fault_ledger (id TEXT PRIMARY KEY, station_id TEXT NOT NULL, fault_type TEXT NOT NULL, source_timestamp TEXT NOT NULL, expected_class TEXT NOT NULL, observed_class TEXT NOT NULL, evidence TEXT NOT NULL)")
        cur.execute("INSERT INTO schema_migrations(version) VALUES (2)")
    if 3 not in versions:
        # Serialize per-station model jobs without preventing archived history.
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_running_training ON training_jobs(station_id) WHERE status = 'RUNNING'")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_model ON model_registry(station_id) WHERE status = 'ACTIVE'")
        cur.execute("INSERT INTO schema_migrations(version) VALUES (3)")
