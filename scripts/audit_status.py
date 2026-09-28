"""Run reproducible repository checks and write honest acceptance evidence.

The tests isolate SQLite and model artifacts. Hardware, a real PostgreSQL service,
browser journeys, and field accuracy are deliberately marked unverified.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'DOCS' / 'status_audit_evidence.json'


def run(command):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    output = (result.stdout + '\n' + result.stderr).strip()
    return {'passed': result.returncode == 0, 'exit_code': result.returncode,
            'summary': output[-1800:]}


def main():
    python = sys.executable
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    checks = {
        'backend_and_ml_tests': run([python, '-m', 'pytest', 'backend/tests', 'ml', '-q', '--tb=short']),
        'frontend_production_build': run([npm, 'run', 'build']),
        'diff_whitespace': run(['git', 'diff', '--check']),
    }
    match = re.search(r'(\d+) passed', checks['backend_and_ml_tests']['summary'])
    checks['backend_and_ml_tests']['passed_count'] = int(match.group(1)) if match else None
    report = {
        'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'scope': 'Disposable SQLite tests, frontend compilation and source-level checks in this workspace',
        'checks': checks,
        'definition_of_done': {
            'met_with_collected_test_evidence': [1, 3, 6, 7, 8, 9, 10, 12],
            'partial_or_unverified': [2, 4, 5, 11, 13, 14, 15],
            'strict_evidence_completion_percent': round(100 * 8 / 15, 1),
            'note': 'This is an unweighted acceptance-evidence count, not a measure of lines of code or operational readiness.'
        },
        'external_validation': {
            'postgresql_migrations_and_integration': 'NOT_VERIFIED',
            'esp32_hardware_compile_and_disconnect_reboot_replay': 'NOT_VERIFIED',
            'browser_role_workflows': 'NOT_VERIFIED',
            'field_accuracy_and_load_benchmarks': 'NOT_VERIFIED',
            'two_full_demo_rehearsals_and_backup_restore': 'NOT_VERIFIED',
        },
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'checks': {k:v['passed'] for k,v in checks.items()},
                      'strict_evidence_completion_percent': report['definition_of_done']['strict_evidence_completion_percent']}, indent=2))
    return 0 if all(v['passed'] for v in checks.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
