#!/usr/bin/env python3
"""
Unit tests for Database Schema and Migrations.
Tests foreign key enforcement, table structures, unique constraints, and WAL mode.
"""

import os
import sys
import sqlite3
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from ingest_datasets import get_db_connection, apply_migrations, register_variables


class TestDatabaseSchema(unittest.TestCase):
    
    def setUp(self):
        self.test_db = "database/tests/test_temp.db"
        if os.path.exists(self.test_db):
            os.remove(self.test_db)
        self.conn = get_db_connection(self.test_db)
        apply_migrations(self.conn)
        register_variables(self.conn)

    def tearDown(self):
        self.conn.close()
        for f in [self.test_db, f"{self.test_db}-shm", f"{self.test_db}-wal"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    def test_tables_created(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [r[0] for r in cursor.fetchall()]
        expected = [
            "source_files", "import_runs", "locations", "grid_points",
            "variables", "observations", "tabular_weather_records",
            "data_quality_issues", "derived_features", "ml_training_datasets",
            "ml_dataset_splits", "anomaly_events", "model_metadata"
        ]
        for tbl in expected:
            self.assertIn(tbl, tables, f"Expected table {tbl} was not found in schema")

    def test_wal_mode_enabled(self):
        cursor = self.conn.cursor()
        cursor.execute("PRAGMA journal_mode;")
        mode = cursor.fetchone()[0]
        self.assertEqual(mode.lower(), "wal")

    def test_foreign_key_enforcement(self):
        cursor = self.conn.cursor()
        with self.assertRaises(sqlite3.IntegrityError):
            cursor.execute("""
                INSERT INTO grid_points (location_id, latitude, longitude, grid_index_i, grid_index_j)
                VALUES (999999, 12.97, 77.59, 0, 0)
            """)

    def test_variable_registration(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT short_name, raw_unit, normalized_unit FROM variables")
        vars_dict = {r[0]: (r[1], r[2]) for r in cursor.fetchall()}
        self.assertIn("t2m", vars_dict)
        self.assertEqual(vars_dict["t2m"], ("K", "degC"))
        self.assertIn("tp", vars_dict)
        self.assertEqual(vars_dict["tp"], ("m", "mm"))


if __name__ == "__main__":
    unittest.main()
