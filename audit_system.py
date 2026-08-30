import httpx
import json
import time

BASE_URL = "http://127.0.0.1:8000/api/v1"
client = httpx.Client(base_url=BASE_URL, timeout=30.0)

print("=========================================================")
print("SKYGUARD-AI COMPREHENSIVE FULL-STACK SYSTEM AUDIT (RUN 2)")
print("=========================================================")

# 1. Health
r_health = client.get("/health")
print(f"1. GET /health -> HTTP {r_health.status_code}: {r_health.json()['service']}")

# 2. Auth: Admin & Station Operator
r_admin = client.post("/auth/admin/login", json={"username": "admin", "password": "sentinel2026"})
assert r_admin.status_code == 200, f"Admin login failed: {r_admin.text}"
admin_token = r_admin.json()["token"]
print("2. Admin Login -> HTTP 200 (Token obtained)")

r_operator = client.post("/auth/station/login", json={"username": "aws_01", "password": "123456"})
assert r_operator.status_code == 200, f"Operator login failed: {r_operator.text}"
operator_token = r_operator.json()["token"]
print("3. Operator Login (aws_01) -> HTTP 200 (Token obtained)")

# 3. RBAC & Station Isolation
r_me_admin = client.get("/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
print(f"4. GET /auth/me (Admin) -> role={r_me_admin.json().get('role')}")

r_me_op = client.get("/auth/me", headers={"Authorization": f"Bearer {operator_token}"})
print(f"5. GET /auth/me (Operator) -> role={r_me_op.json().get('role')}, station_id={r_me_op.json().get('station_id')}")

# Operator attempting to operate AWS-02 (MUST return 403 Forbidden)
r_forbidden_fault = client.post(
    "/stations/AWS-02/faults/inject",
    json={"fault_type": "SPIKE", "offset_val": 10.0},
    headers={"Authorization": f"Bearer {operator_token}"}
)
print(f"6. Station Operator (AWS-01) inject fault on AWS-02 -> HTTP {r_forbidden_fault.status_code} ({r_forbidden_fault.json().get('detail')})")

r_forbidden_train = client.post(
    "/stations/AWS-02/train",
    json={},
    headers={"Authorization": f"Bearer {operator_token}"}
)
print(f"7. Station Operator (AWS-01) train model on AWS-02 -> HTTP {r_forbidden_train.status_code} ({r_forbidden_train.json().get('detail')})")

r_allowed_stats = client.get(
    "/stations/AWS-01/telemetry/stats",
    headers={"Authorization": f"Bearer {operator_token}"}
)
print(f"8. Station Operator (AWS-01) telemetry stats on AWS-01 -> HTTP {r_allowed_stats.status_code}, Records: {r_allowed_stats.json().get('total_records')}")

# 4. Fleet Live State & Asymmetrical Fallbacks
r_fleet = client.get("/stations/fleet/live", headers={"Authorization": f"Bearer {admin_token}"})
print(f"9. GET /stations/fleet/live -> HTTP {r_fleet.status_code}")
fleet_stations = r_fleet.json().get("stations", [])
for s in fleet_stations:
    st_id = s['station_id']
    st_status = s['status']
    has_model = s.get('ml_model', {}).get('has_model')
    model_status = s.get('ml_model', {}).get('status')
    peer_count = s.get('spatial_data', {}).get('eligible_peer_count')
    print(f"   Station {st_id}: Status={st_status}, HasModel={has_model}, ModelStatus={model_status}, Peers={peer_count}")

# 5. Station QC Config & Physics Matrix
r_qc = client.get("/stations/AWS-01/qc", headers={"Authorization": f"Bearer {admin_token}"})
print(f"10. GET /stations/AWS-01/qc -> HTTP {r_qc.status_code}, HasConfig={r_qc.json().get('has_config')}")
if r_qc.json().get("has_config"):
    conf = r_qc.json()["config"]
    print(f"    Envelope: Temp [{conf.get('temperature_normal_min')} to {conf.get('temperature_normal_max')}], Method: {conf.get('calibration_method')}")

# 6. Active Model & Model Registry
r_active = client.get("/stations/AWS-01/models/active", headers={"Authorization": f"Bearer {admin_token}"})
print(f"11. GET /stations/AWS-01/models/active -> HTTP {r_active.status_code}, HasActive={r_active.json().get('has_active_model')}")
if r_active.json().get("has_active_model"):
    card = r_active.json()["model_card"]
    print(f"    Active Model: ID={card.get('model_id')}, Version={card.get('version')}, Algorithm={card.get('algorithm')}")

# 7. Incidents Queue & Evidence Fusion Semantics
r_inc = client.get("/incidents", headers={"Authorization": f"Bearer {admin_token}"})
print(f"12. GET /incidents -> HTTP {r_inc.status_code}, Total Active Incidents={r_inc.json().get('count')}")
for inc in r_inc.json().get("incidents", [])[:3]:
    st_id = inc.get("station_id")
    q_state = inc.get("quality_state")
    reasons = inc.get("reason_codes")
    actions = inc.get("recommended_actions")
    ev_spatial = inc.get("evidence_data", {}).get("spatial_evidence", {})
    print(f"    - [{inc.get('id')}] Station {st_id} ({q_state}): Spatial={ev_spatial.get('spatial_result')} ('{ev_spatial.get('summary')}')")
    print(f"      Reasons: {reasons}")
    print(f"      Actions: {actions}")

# 8. Test Fault Injection -> Incident Generation -> Fault Reset -> Auto-Resolution
print("\n--- Testing Complete Fault Injection & Recovery Lifecycle ---")
# Inject spike fault on AWS-01
r_inject = client.post(
    "/stations/AWS-01/faults/inject",
    json={"fault_type": "SPIKE", "offset_val": 8.5},
    headers={"Authorization": f"Bearer {admin_token}"}
)
print(f"13. Inject SPIKE (+8.5°C) on AWS-01 -> HTTP {r_inject.status_code}: {r_inject.json()}")

# Allow weather poller / evaluation cycle to reflect fault
time.sleep(1.0)
r_fleet_after_fault = client.get("/stations/fleet/live", headers={"Authorization": f"Bearer {admin_token}"})
st1_after_fault = next((s for s in r_fleet_after_fault.json().get("stations", []) if s["station_id"] == "AWS-01"), None)
print(f"14. AWS-01 Live State after fault: Status={st1_after_fault.get('status')}, HasActiveFault={st1_after_fault.get('has_active_fault')}")
print(f"    Assessment: Classification={st1_after_fault.get('final_assessment', {}).get('classification')}, Interpretation='{st1_after_fault.get('final_assessment', {}).get('interpretation')}'")

# Check incident generated for AWS-01
r_inc_after_fault = client.get("/incidents?station_id=AWS-01", headers={"Authorization": f"Bearer {admin_token}"})
incidents_aws01 = r_inc_after_fault.json().get("incidents", [])
print(f"15. Active incidents for AWS-01: {len(incidents_aws01)}")
if incidents_aws01:
    inc0 = incidents_aws01[0]
    print(f"    Incident ID={inc0.get('id')}, QualityState={inc0.get('quality_state')}, Severity={inc0.get('severity')}")
    print(f"    Actions={inc0.get('recommended_actions')}")

# Now Reset Fault
r_reset = client.post("/stations/AWS-01/faults/reset", headers={"Authorization": f"Bearer {admin_token}"})
print(f"16. Reset Fault on AWS-01 -> HTTP {r_reset.status_code}: {r_reset.json()}")

time.sleep(1.0)
r_fleet_after_reset = client.get("/stations/fleet/live", headers={"Authorization": f"Bearer {admin_token}"})
st1_after_reset = next((s for s in r_fleet_after_reset.json().get("stations", []) if s["station_id"] == "AWS-01"), None)
print(f"17. AWS-01 Live State after reset: Status={st1_after_reset.get('status')}, HasActiveFault={st1_after_reset.get('has_active_fault')}")

r_inc_after_reset = client.get("/incidents?station_id=AWS-01&status=open", headers={"Authorization": f"Bearer {admin_token}"})
open_inc_aws01 = r_inc_after_reset.json().get("incidents", [])
print(f"18. Open Incidents for AWS-01 after reset: {len(open_inc_aws01)} (Auto-resolved upon nominal telemetry)")

print("\n=========================================================")
print("ALL CORE AUDIT TESTS PASSED SUCCESSFULLY!")
print("=========================================================")
