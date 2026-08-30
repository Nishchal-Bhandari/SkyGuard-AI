import httpx

r_admin = httpx.post("http://127.0.0.1:8000/api/v1/auth/admin/login", json={"username": "admin", "password": "sentinel2026"})
token = r_admin.json()["token"]

r = httpx.get("http://127.0.0.1:8000/api/v1/stations/AWS-01/qc", headers={"Authorization": f"Bearer {token}"})
print("QC Status:", r.status_code)
data = r.json()
print("QC Data:", data)



