import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth.security import create_access_token
from backend.app.api.v1.telemetry import parse_iso_or_datetime

client = TestClient(app)

@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token({"sub": "admin", "role": "admin", "name": "Admin"})
    return {"Authorization": f"Bearer {token}"}

def test_parse_iso_valid():
    ts = "2026-08-01 12:34:56"
    iso = parse_iso_or_datetime(ts)
    # Should be ISO format with UTC offset
    assert iso.endswith("+00:00") or iso.endswith("Z")
    # The date part should match
    assert iso.startswith("2026-08-01T12:34:56")

def test_parse_iso_invalid():
    with pytest.raises(ValueError):
        parse_iso_or_datetime("not-a-date")

def test_csv_upload_reject_invalid_timestamp(admin_headers):
    # Build CSV with one valid and one invalid timestamp row
    csv_content = """station_id,timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm\n"""
    csv_content += "AWS-01,2026-08-01 00:00:00,25,50,1010,10,0\n"
    csv_content += "AWS-01,invalid-time,26,55,1011,11,0\n"
    response = client.post(
        "/api/v1/stations/AWS-01/telemetry/upload",
        files={"file": ("test.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    # Should have rejected at least one row
    assert data["rows_rejected"] >= 1 or data["rows_queued"] == 1
    # Ensure success flag is true
    assert data["success"] is True
