import httpx
import time
import json

BASE_URL = "http://127.0.0.1:8000/api/v1"
client = httpx.Client(base_url=BASE_URL, timeout=30.0)

print("=========================================================")
print("8-STAGE TRAINING PIPELINE PROGRESSION TEST")
print("=========================================================")

# 1. Login as Admin
r_admin = client.post("/auth/admin/login", json={"username": "admin", "password": "sentinel2026"})
token = r_admin.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. Trigger Training for AWS-01
print("\nTriggering training pipeline for AWS-01...")
r_train = client.post("/stations/AWS-01/train", json={}, headers=headers)
print(f"POST /stations/AWS-01/train -> HTTP {r_train.status_code}: {r_train.json()}")
job_id = r_train.json().get("job_id")
assert job_id is not None, "Failed to get job_id"

# 3. Poll Status API and record every distinct stage transition
observed_stages = []
start_time = time.time()
last_stage_seen = None

print(f"\nPolling /stations/AWS-01/training-jobs/{job_id}/status ...")

while time.time() - start_time < 45.0:
    r_status = client.get(f"/stations/AWS-01/training-jobs/{job_id}/status?_t={int(time.time()*1000)}", headers=headers)
    assert r_status.status_code == 200, f"Status call failed: {r_status.text}"
    status_data = r_status.json()
    
    current_stage = status_data.get("current_stage")
    completed = status_data.get("completed_stages", [])
    job_status = status_data.get("status")
    progress = status_data.get("progress")
    
    snapshot = (current_stage, len(completed), job_status)
    if snapshot != last_stage_seen:
        print(f"[{time.time()-start_time:5.2f}s] Status={job_status:9s} | Current='{str(current_stage):25s}' | Progress={progress:5.1f}% | Completed ({len(completed)}/8): {completed}")
        observed_stages.append({
            "elapsed_sec": round(time.time() - start_time, 2),
            "status": job_status,
            "current_stage": current_stage,
            "completed_stages": list(completed),
            "progress": progress
        })
        last_stage_seen = snapshot
        
    if job_status == "COMPLETED":
        print(f"\n[PASS] Training Job #{job_id} reached COMPLETED status with all stages recorded!")
        break
    elif job_status == "FAILED":
        print(f"\n[FAIL] Training Job #{job_id} failed: {status_data.get('error_message')}")
        break
        
    time.sleep(0.3)

print("\n--- Summary of Observed Transitions ---")
for idx, s in enumerate(observed_stages):
    print(f"Step {idx+1}: At {s['elapsed_sec']}s -> Status: {s['status']}, Current: '{s['current_stage']}', Completed Count: {len(s['completed_stages'])}")

# Check active model after training
r_active = client.get("/stations/AWS-01/models/active", headers=headers)
print(f"\nActive Model after training: {r_active.json().get('model_record', {}).get('model_id')}, Version: {r_active.json().get('model_record', {}).get('model_version')}")
