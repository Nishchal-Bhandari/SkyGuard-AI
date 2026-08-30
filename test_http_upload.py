"""
SkyGuard-AI Backend API Verification Script
Tests: /health, /telemetry/stats (public), /telemetry/upload (admin JWT)
Run from workspace root:  python test_http_upload.py
"""

import urllib.request
import urllib.error
import json
import time
import sys
import os

BASE_URL = "http://127.0.0.1:8000/api/v1"
STATION_ID = "AWS-01"

# -- Token generation (import from backend) ------------------------------------
try:
    from backend.app.auth.security import create_access_token
    TOKEN = create_access_token({"sub": "admin", "role": "admin"})
    print(f"[OK] Token generated (first 40 chars): {TOKEN[:40]}...\n")
except Exception as e:
    print(f"[FAIL] Could not generate token: {e}")
    sys.exit(1)


def request(method, path, data=None, headers=None, label=""):
    """Simple HTTP helper - returns parsed JSON or None on error."""
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode()
            parsed = json.loads(body)
            print(f"[{resp.status}] {label or f'{method} {path}'}")
            print(f"    -> {json.dumps(parsed)[:200]}")
            print()
            return parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[{e.code}] {label or f'{method} {path}'} -- {e.reason}")
        print(f"    -> {body[:300]}")
        print()
        return None
    except urllib.error.URLError as e:
        print(f"[CONNECTION ERROR] {label or f'{method} {path}'} -- {e.reason}")
        print("    -> Is the backend running?  python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000")
        print()
        return None


BOUNDARY = "----SkyGuardBoundary1234567890"


def make_multipart(filename, csv_bytes):
    body = bytearray()
    body.extend(f"--{BOUNDARY}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: text/csv\r\n\r\n")
    body.extend(csv_bytes)
    body.extend(f"\r\n--{BOUNDARY}--\r\n".encode())
    return bytes(body)


# -- 1. Health check -----------------------------------------------------------
print("=" * 60)
print("TEST 1: Health Check (public)")
print("=" * 60)
request("GET", "/health", label="GET /health")

# -- 2. Telemetry stats - no auth (should be public) --------------------------
print("=" * 60)
print("TEST 2: Telemetry Stats - no Authorization header")
print("=" * 60)
request(
    "GET",
    f"/stations/{STATION_ID}/telemetry/stats",
    label=f"GET /stations/{STATION_ID}/telemetry/stats (unauthenticated)",
)

# -- 3. Telemetry stats - with admin JWT --------------------------------------
print("=" * 60)
print("TEST 3: Telemetry Stats - with admin JWT")
print("=" * 60)
request(
    "GET",
    f"/stations/{STATION_ID}/telemetry/stats",
    headers={"Authorization": f"Bearer {TOKEN}"},
    label=f"GET /stations/{STATION_ID}/telemetry/stats (authenticated)",
)

# -- 4. CSV Upload - minimal inline sample ------------------------------------
print("=" * 60)
print("TEST 4: CSV Upload - small inline sample (3 rows)")
print("=" * 60)

CSV_SAMPLE = (
    b"valid_time_utc,t2m_deg_c,relative_humidity_pct,msl_hpa,tp_mm\r\n"
    b"2026-08-01 10:00:00,28.5,52.0,1006.5,0.0\r\n"
    b"2026-08-01 11:00:00,29.1,50.2,1006.2,0.0\r\n"
    b"2026-08-01 12:00:00,30.0,48.8,1006.0,0.0\r\n"
)

t0 = time.time()
request(
    "POST",
    f"/stations/{STATION_ID}/telemetry/upload",
    data=make_multipart("test_sample.csv", CSV_SAMPLE),
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
    },
    label=f"POST /stations/{STATION_ID}/telemetry/upload (CSV, 3 rows)",
)
print(f"    Upload round-trip: {time.time() - t0:.2f}s\n")

# -- 5. Upload real dataset file (if it exists) --------------------------------
REAL_CSV = "karnataka_weather_ml_v1_validation.csv"
print("=" * 60)
print(f"TEST 5: Upload real dataset - {os.path.basename(REAL_CSV)}")
print("=" * 60)

if os.path.exists(REAL_CSV):
    with open(REAL_CSV, "rb") as f:
        csv_bytes = f.read()
    t0 = time.time()
    request(
        "POST",
        f"/stations/{STATION_ID}/telemetry/upload",
        data=make_multipart(os.path.basename(REAL_CSV), csv_bytes),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
        },
        label=f"POST upload {os.path.basename(REAL_CSV)} ({len(csv_bytes):,} bytes)",
    )
    print(f"    Upload round-trip: {time.time() - t0:.2f}s\n")
else:
    print(f"    [SKIP] File not found: {REAL_CSV}\n")

print("=" * 60)
print("All tests complete.")
