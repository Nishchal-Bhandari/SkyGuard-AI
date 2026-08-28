#!/usr/bin/env python3
"""
Unit tests for Database Backup and Restore Manager.
"""

import os
import sys
import sqlite3
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from backup_restore import backup_database, restore_database


class TestBackupRestore(unittest.TestCase):
    
    def setUp(self):
        self.test_db = "database/tests/test_src.db"
        self.backup_dir = "database/tests/backups"
        self.restored_db = "database/tests/test_dst.db"
        
        # Create minimal source DB
        conn = sqlite3.connect(self.test_db)
        conn.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, val TEXT);")
        conn.execute("INSERT INTO sample (val) VALUES ('test_value');")
        conn.commit()
        conn.close()

    def tearDown(self):
        for f in [self.test_db, self.restored_db]:
            if os.path.exists(f):
                os.remove(f)
        if os.path.exists(self.backup_dir):
            import shutil
            shutil.rmtree(self.backup_dir, ignore_errors=True)

    def test_backup_and_restore_cycle(self):
        backup_file = backup_database(self.test_db, self.backup_dir)
        self.assertTrue(os.path.exists(backup_file))
        
        success = restore_database(backup_file, self.restored_db)
        self.assertTrue(success)
        self.assertTrue(os.path.exists(self.restored_db))
        
        # Verify data restored
        conn = sqlite3.connect(self.restored_db)
        cursor = conn.cursor()
        cursor.execute("SELECT val FROM sample WHERE id = 1;")
        val = cursor.fetchone()[0]
        conn.close()
        self.assertEqual(val, "test_value")


if __name__ == "__main__":
    unittest.main()
