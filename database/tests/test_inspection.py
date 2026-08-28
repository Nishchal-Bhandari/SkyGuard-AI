#!/usr/bin/env python3
"""
Unit tests for Dataset Inspection Engine.
Tests recursive discovery, SHA-256 calculation, and NetCDF metadata extraction using real dataset files.
"""

import os
import sys
import unittest

# Add scripts directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
from inspect_datasets import inspect_netcdf_file, compute_sha256, run_inspection


class TestDatasetInspection(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.data_dir = "Datasets"
        if not os.path.exists(cls.data_dir):
            for alt in ["docs/datasets", "datasets"]:
                if os.path.exists(alt):
                    cls.data_dir = alt
                    break
        cls.test_file = os.path.join(cls.data_dir, "Bengaluru_urban_2025(2)", "data_stream-oper_stepType-instant.nc")

    def test_sha256_computation(self):
        self.assertTrue(os.path.exists(self.test_file), f"Test fixture not found: {self.test_file}")
        h1 = compute_sha256(self.test_file)
        h2 = compute_sha256(self.test_file)
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)

    def test_inspect_netcdf_metadata(self):
        meta = inspect_netcdf_file(self.test_file)
        self.assertEqual(meta["format"], "netcdf4")
        self.assertEqual(meta["step_type"], "instant")
        self.assertIn("valid_time", meta["dimensions"])
        self.assertIn("latitude", meta["dimensions"])
        self.assertIn("longitude", meta["dimensions"])
        self.assertIn("t2m", meta["data_variables"])
        self.assertIn("d2m", meta["data_variables"])
        self.assertIn("msl", meta["data_variables"])
        self.assertEqual(meta["spatial_grid"]["num_latitudes"], 4)
        self.assertEqual(meta["spatial_grid"]["num_longitudes"], 4)
        self.assertEqual(meta["spatial_grid"]["total_grid_points"], 16)
        self.assertEqual(meta["num_timestamps"], 4416)

    def test_full_inspection_run(self):
        out_dir = "database/reports"
        summary = run_inspection(self.data_dir, out_dir)
        self.assertGreaterEqual(summary["total_files"], 40)
        self.assertIn("discovered_variables", summary)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "dataset_inspection_report.json")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "dataset_inspection_report.md")))


if __name__ == "__main__":
    unittest.main()
