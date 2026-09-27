#!/usr/bin/env python3
"""Run backend automated tests and report exactly what they establish."""
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path


def main() -> int:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "backend/tests", "-q", "--tb=short"],
        capture_output=True,
        text=True,
    )
    output = "\n".join(part for part in (result.stdout, result.stderr) if part)
    summary = re.search(r"(?P<count>\d+) passed(?:, (?P<rest>.*?))?\s*(?:in [\d.]+s)?$", output, re.MULTILINE)
    passed_count = int(summary.group("count")) if summary else None
    report = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "automated_test_suite": {
            "status": "PASS" if result.returncode == 0 else "FAIL",
            "passed": passed_count,
            "exit_code": result.returncode,
            "output": output,
        },
        "project_acceptance": {
            "status": "NOT_CALCULATED",
            "weighted_score": None,
            "reason": "A passing test suite does not establish full specification coverage. Criteria require individual evidence mapping.",
        },
        "field_validation": "NOT_PERFORMED",
    }
    Path("acceptance_status.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(output, end="" if output.endswith("\n") else "\n")
    print(f"Acceptance report written. Automated tests: {report['automated_test_suite']['status']}; project score: NOT_CALCULATED.")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
