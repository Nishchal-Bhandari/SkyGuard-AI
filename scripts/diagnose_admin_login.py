"""Read-only diagnosis of configured bootstrap credentials versus the active DB.

Never prints connection strings, passwords, password hashes, or tokens.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import DATABASE_URL, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, DEMO_MODE
from backend.app.auth.security import verify_password
from backend.app.storage.database import get_db


def main():
    result = {
        'database_kind': 'postgresql' if DATABASE_URL.startswith('postgresql') else 'sqlite',
        'configured_admin_username': DEFAULT_ADMIN_USERNAME,
        'configured_password_length': len(DEFAULT_ADMIN_PASSWORD),
        'configured_password_is_demo_default': DEFAULT_ADMIN_PASSWORD == 'sentinel2026',
        'demo_mode': DEMO_MODE,
    }
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT password_hash, status FROM admins WHERE username = ?', (DEFAULT_ADMIN_USERNAME.lower(),))
            row = cur.fetchone()
        result['account_exists'] = bool(row)
        if row:
            result['account_active'] = row['status'] == 'ACTIVE'
            result['hash_scheme'] = 'argon2id' if row['password_hash'].startswith('$argon2id$') else 'legacy'
            result['bootstrap_password_matches'] = verify_password(DEFAULT_ADMIN_PASSWORD, row['password_hash'])
            result['note'] = 'DEFAULT_ADMIN_PASSWORD seeds only a new account; it never resets an existing account.'
    except Exception as error:
        result['database_error_type'] = type(error).__name__
    print(json.dumps(result, indent=2))
    return 0 if 'database_error_type' not in result else 1


if __name__ == '__main__':
    raise SystemExit(main())
