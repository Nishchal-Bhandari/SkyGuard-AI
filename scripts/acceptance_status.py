#!/usr/bin/env python3
"""Run the pytest suite and emit a simple JSON acceptance‑status report.
The CI workflow calls this script after installing dependencies.
"""
import subprocess
import json
import datetime
import sys

def run_tests():
    # Run pytest; exit code 0 == all passed
    result = subprocess.run([sys.executable, "-m", "pytest", "backend/tests"], capture_output=True, text=True)
    passed = result.returncode == 0
    return passed, result.stdout, result.stderr

if __name__ == "__main__":
    passed, out, err = run_tests()
    status = {
        "all_passed": passed,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "details": "All tests passed" if passed else "Some tests failed",
        "stdout": out,
        "stderr": err,
    }
    with open("acceptance_status.json", "w", encoding="utf-8") as f:
        json.dump(status, f, indent=2, ensure_ascii=False)
    # Exit with pytest's code so CI can fail if needed
    sys.exit(0 if passed else 1)
