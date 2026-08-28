#!/usr/bin/env python3
"""
Unit tests for Data Quality Validation Engine.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from validate_data_quality import run_data_quality_checks


class TestDataQuality(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.db_path = "data/weather_app.db"
        cls.report_path = "database/reports/test_quality_report.json"

    def test_quality_audit_execution(self):
        if not os.path.exists(self.db_path):
            self.skipTest(f"Database not yet created at {self.db_path}")
            
        summary = run_data_quality_checks(self.db_path, self.report_path)
        self.assertIn("quality_metrics", summary)
        self.assertIn("data_health_score_pct", summary["quality_metrics"])
        self.assertGreaterEqual(summary["quality_metrics"]["data_health_score_pct"], 90.0)
        self.assertTrue(os.path.exists(self.report_path))
        
        if os.path.exists(self.report_path):
            os.remove(self.report_path)


if __name__ == "__main__":
    unittest.main()
