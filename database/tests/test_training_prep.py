#!/usr/bin/env python3
"""
Unit tests for Machine Learning Preparation and Export Engines.
"""

import os
import sys
import unittest
import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from prepare_training_data import prepare_ml_dataset, build_ml_features
from export_training_data import export_training_datasets


class TestTrainingPreparation(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.db_path = "data/weather_app.db"
        cls.export_dir = "database/exports"

    def test_feature_engineering_and_splitting(self):
        if not os.path.exists(self.db_path):
            self.skipTest(f"Database not yet created at {self.db_path}")
            
        res = prepare_ml_dataset(self.db_path, "test_dataset_v1", "1.0.0")
        self.assertIn("config_hash", res)
        self.assertGreater(res["total_rows"], 0)
        self.assertGreater(res["total_columns"], 20)
        self.assertIn("train", res["splits"])
        self.assertIn("validation", res["splits"])
        self.assertIn("test", res["splits"])

    def test_export_datasets(self):
        if not os.path.exists(self.db_path):
            self.skipTest(f"Database not yet created at {self.db_path}")
            
        res = export_training_datasets(self.db_path, self.export_dir, "test_dataset_v1")
        self.assertIn("train", res)
        self.assertTrue(os.path.exists(res["train"]["csv_path"]))
        self.assertTrue(os.path.exists(res["train"]["parquet_path"]))
        
        # Verify parquet read
        df_parq = pd.read_parquet(res["train"]["parquet_path"])
        self.assertEqual(len(df_parq), res["train"]["rows"])


if __name__ == "__main__":
    unittest.main()
