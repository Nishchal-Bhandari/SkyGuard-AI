#!/usr/bin/env python3
"""
Test Suite Runner
Discovers and executes all database tests in database/tests/ and provides a summary.
"""

import os
import sys
import unittest


def run_all():
    print("=" * 70)
    print(" SKYGUARD-AI DATABASE TEST SUITE EXECUTION")
    print("=" * 70)
    
    loader = unittest.TestLoader()
    start_dir = os.path.dirname(os.path.abspath(__file__))
    suite = loader.discover(start_dir, pattern="test_*.py")
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    print("\n" + "=" * 70)
    print(f" Tests Run:   {result.testsRun}")
    print(f" Successes:   {result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped)}")
    print(f" Failures:    {len(result.failures)}")
    print(f" Errors:      {len(result.errors)}")
    print(f" Skipped:     {len(result.skipped)}")
    print("=" * 70)
    
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
