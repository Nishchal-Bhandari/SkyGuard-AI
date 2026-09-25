import httpx
import datetime
import random

# Generate a fake CSV with 15000 rows
print("Generating CSV...")
with open("test_weather.csv", "w") as f:
    f.write("date,temp,hum,pres,wind,rain\n")
    now = datetime.datetime.now(datetime.timezone.utc)
    for i in range(15000):
        dt = (now - datetime.timedelta(hours=i)).isoformat()
        f.write(f"{dt},25.0,60.0,1010.0,12.0,0.0\n")

print("Uploading to backend...")
with open("test_weather.csv", "rb") as f:
    files = {"file": ("test_weather.csv", f, "text/csv")}
    # Need to authenticate to get token
    from backend.app.auth.security import create_access_token
    token = create_access_token({"sub": "admin", "role": "admin"})
    
    headers = {"Authorization": f"Bearer {token}"}
    res = httpx.post("http://127.0.0.1:8000/api/v1/stations/AWS-01/telemetry/upload", files=files, headers=headers, timeout=None)
    print(res.status_code, res.text)
