import hashlib
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth.security import hash_password, verify_password, create_access_token
from backend.app.storage.database import init_db, get_db, create_training_job


@pytest.fixture
def secured():
    init_db()
    client = TestClient(app)
    admin = {"Authorization": "Bearer " + create_access_token({"sub": "admin", "role": "admin"})}
    for sid in ("SEC-A", "SEC-B"):
        client.post("/api/v1/admin/stations", headers=admin, json={
            "station_id": sid, "station_name": sid, "username": sid.lower(),
            "password": "private-test-password", "latitude": 12, "longitude": 77,
        })
    operator = {"Authorization": "Bearer " + create_access_token({"sub": "sec-a", "role": "station_operator", "station_id": "SEC-A"})}
    return client, admin, operator


def test_argon_and_legacy_password_compatibility():
    hashed = hash_password("password")
    assert hashed.startswith("$argon2id$")
    assert verify_password("password", hashed)
    assert not verify_password("incorrect", hashed)
    salt = b"legacy-test-salt"
    legacy = "pbkdf2:sha256:100000$" + salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", b"password", salt, 100000).hex()
    assert verify_password("password", legacy)


def test_credentials_not_stored_or_serialized(secured):
    client, admin, _ = secured
    response = client.get("/api/v1/admin/stations", headers=admin)
    assert response.status_code == 200
    assert all(not ({"password", "password_hash", "access_key", "device_key_hash"} & set(row)) for row in response.json())
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT password_hash, access_key FROM stations WHERE station_id = 'SEC-A'")
        row = cur.fetchone()
        assert row["access_key"] in ("", None)
        assert verify_password("private-test-password", row["password_hash"])
    with pytest.raises(Exception, match="plaintext"):
        with get_db() as conn:
            conn.cursor().execute("UPDATE stations SET access_key = 'exposed' WHERE station_id = 'SEC-A'")


@pytest.mark.parametrize("route", ["/telemetry/esp32/latest?station_id=SEC-B", "/stations/SEC-B/assessments", "/stations/SEC-B/evidence", "/stations/SEC-B/faults", "/stations/SEC-B/models", "/stations/SEC-B/training-jobs"])
def test_station_read_matrix(secured, route):
    client, admin, operator = secured
    url = "/api/v1" + route
    assert client.get(url).status_code == 401
    assert client.get(url, headers=operator).status_code == 403
    assert client.get(url, headers=admin).status_code == 200
    assert client.get(url.replace("SEC-B", "SEC-A"), headers=operator).status_code == 200


def test_job_id_ownership_and_fleet_reset(secured):
    client, admin, operator = secured
    with get_db() as conn:
        conn.cursor().execute("UPDATE training_jobs SET status = 'FAILED' WHERE station_id = 'SEC-B'")
    job = create_training_job("SEC-B", "security-test")
    assert client.get(f"/api/v1/stations/SEC-A/training-jobs/{job}/status", headers=operator).status_code == 404
    assert client.get(f"/api/v1/stations/SEC-B/training-jobs/{job}/status", headers=admin).status_code == 200
    assert client.post("/api/v1/stations/fleet/faults/reset", headers=operator).status_code == 403
