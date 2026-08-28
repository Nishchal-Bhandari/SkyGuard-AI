#!/usr/bin/env python3
"""
Unit and Integration tests for Ingestion Engine.
Tests batch processing, unit normalization, coordinate indexing, and idempotent re-import using real dataset fixtures.
"""

import os
import sys
import sqlite3
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from ingest_datasets import ingest_all_datasets, get_db_connection


class TestDatasetIngestion(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        # Use a specific real district fixture for ultra-fast integration testing
        cls.data_dir = os.path.join("Datasets", "bengaluru_urban_2025(1)")
        if not os.path.exists(cls.data_dir):
            for alt in [os.path.join("docs/datasets", "bengaluru_urban_2025(1)"), "Datasets"]:
                if os.path.exists(alt):
                    cls.data_dir = alt
                    break
        cls.test_db = "database/tests/test_ingest_fixture.db"
        if os.path.exists(cls.test_db):
            try:
                os.remove(cls.test_db)
            except Exception:
                pass

    @classmethod
    def tearDownClass(cls):
        for f in [cls.test_db, f"{cls.test_db}-shm", f"{cls.test_db}-wal"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    def test_01_ingest_run(self):
        # Ingest datasets into temporary test DB
        summary = ingest_all_datasets(self.data_dir, self.test_db)
        self.assertGreater(summary["files_imported"], 0)
        self.assertEqual(summary["files_failed"], 0)
        self.assertGreater(summary["total_records_inserted"], 0)

    def test_02_idempotent_reimport(self):
        # Running ingestion again should skip all existing files without errors
        summary = ingest_all_datasets(self.data_dir, self.test_db)
        self.assertEqual(summary["files_imported"], 0)
        self.assertEqual(summary["files_skipped"], summary["files_scanned"])
        self.assertEqual(summary["files_failed"], 0)

    def test_03_data_integrity(self):
        conn = get_db_connection(self.test_db)
        cursor = conn.cursor()
        
        # Verify locations
        cursor.execute("SELECT COUNT(*) FROM locations")
        n_locs = cursor.fetchone()[0]
        self.assertGreaterEqual(n_locs, 1)
        
        # Verify grid points
        cursor.execute("SELECT COUNT(*) FROM grid_points")
        n_pts = cursor.fetchone()[0]
        self.assertGreaterEqual(n_pts, 4)
        
        # Verify observations and unit conversion
        cursor.execute("""
            SELECT raw_value, raw_unit, normalized_value, normalized_unit
            FROM observations
            WHERE variable_id = (SELECT variable_id FROM variables WHERE short_name = 't2m')
            LIMIT 10
        """)
        rows = cursor.fetchall()
        self.assertTrue(len(rows) > 0)
        for r in rows:
            self.assertEqual(r["raw_unit"], "K")
            self.assertEqual(r["normalized_unit"], "degC")
            self.assertAlmostEqual(r["normalized_value"], r["raw_value"] - 273.15, places=2)
            
        conn.close()


if __name__ == "__main__":
    unittest.main()
