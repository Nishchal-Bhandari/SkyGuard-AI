"""
End-to-end training pipeline test.
1. Generates 500 realistic weather rows and uploads them.
2. Triggers training for AWS-01.
3. Polls job status every 2s until COMPLETED or FAILED (max 120s).
4. Fetches /models/active to confirm the model is registered.
"""
import csv, io, random, math, time, httpx, sys
from backend.app.auth.security import create_access_token

BASE = "http://127.0.0.1:8000/api/v1"
STATION = "AWS-01"
TOKEN = create_access_token({"sub": "admin", "role": "admin"})
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# ── 1. Upload realistic telemetry ─────────────────────────────────────────────
print("Step 1: Uploading telemetry CSV...")
buf = io.StringIO()
w = csv.writer(buf)
w.writerow(["timestamp", "temperature_c", "humidity_pct", "pressure_hpa", "wind_speed_kmh", "rainfall_mm"])
base_ts = 1700000000
for i in range(500):
    ts = f"2024-01-01T{(i//60)%24:02d}:{i%60:02d}:00Z"
    temp = 25.0 + 5 * math.sin(i * 0.05) + random.uniform(-1, 1)
    hum  = 60.0 + 15 * math.cos(i * 0.03) + random.uniform(-2, 2)
    pres = 1010.0 + 3 * math.sin(i * 0.02) + random.uniform(-0.5, 0.5)
    wind = abs(10.0 + random.gauss(0, 3))
    rain = max(0, random.gauss(0, 0.5))
    w.writerow([ts, round(temp,2), round(hum,2), round(pres,2), round(wind,2), round(rain,2)])

csv_bytes = buf.getvalue().encode()
files = {"file": ("weather.csv", csv_bytes, "text/csv")}
r = httpx.post(f"{BASE}/stations/{STATION}/telemetry/upload", files=files, headers=HEADERS, timeout=30)
print(f"  Upload → {r.status_code}: {r.json()}")
if r.status_code != 200:
    print("FATAL: upload failed"); sys.exit(1)

# Give background ingestion a moment to settle
time.sleep(3)

# ── 2. Trigger training ───────────────────────────────────────────────────────
print("\nStep 2: Triggering training...")
r = httpx.post(f"{BASE}/stations/{STATION}/train", headers=HEADERS, json={}, timeout=10)
print(f"  Train → {r.status_code}: {r.json()}")
if r.status_code != 200:
    print("FATAL: train endpoint failed"); sys.exit(1)
job_id = r.json().get("job_id")
print(f"  Job ID: {job_id}")

# ── 3. Poll job status ────────────────────────────────────────────────────────
print("\nStep 3: Polling job status...")
deadline = time.time() + 120
last_stage = None
while time.time() < deadline:
    r = httpx.get(f"{BASE}/stations/{STATION}/training-jobs/{job_id}/status", headers=HEADERS, timeout=10)
    if r.status_code != 200:
        print(f"  Status poll error: {r.status_code}"); time.sleep(2); continue
    data = r.json()
    stage = data.get("current_stage", "?")
    status = data.get("status", "?")
    if stage != last_stage:
        print(f"  [{status}] Stage: {stage}")
        last_stage = stage
    if status in ("COMPLETED", "FAILED", "ERROR"):
        print(f"\n  Final status: {status}")
        if status != "COMPLETED":
            print(f"  Error: {data.get('error_message')}")
            sys.exit(1)
        break
    time.sleep(2)
else:
    print("TIMEOUT: Training did not complete in 120s"); sys.exit(1)

# ── 4. Check active model ─────────────────────────────────────────────────────
print("\nStep 4: Checking active model...")
r = httpx.get(f"{BASE}/stations/{STATION}/models/active", headers=HEADERS, timeout=10)
print(f"  Active model → {r.status_code}: {r.json()}")
if r.status_code == 200:
    mc = r.json().get("model_card", {})
    print(f"\n✅ SUCCESS — Model '{mc.get('model_id')}' version {mc.get('version')} is ACTIVE for {STATION}")
else:
    print("❌ No active model found — training may have failed silently"); sys.exit(1)
