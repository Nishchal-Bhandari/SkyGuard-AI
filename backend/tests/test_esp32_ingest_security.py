import unittest
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth.security import create_access_token
from backend.app.auth.security import hash_password
from backend.app.api.v1.telemetry import parse_iso_or_datetime
from backend.app.storage.database import get_db, init_db
from fastapi import HTTPException
from starlette.requests import Request
import backend.app.api.v1.telemetry as telemetry_module

class TestESP32IngestSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        # Create a station operator token for station AWS-01
        cls.station_token = create_access_token({
            "sub": "operator_aws01",
            "role": "station_operator",
            "station_id": "AWS-01",
            "name": "Station Operator"
        })
        cls.headers = {"Authorization": f"Bearer {cls.station_token}"}
        cls.admin_headers = {"Authorization": f"Bearer {create_access_token({'sub': 'admin', 'role': 'admin'})}"}
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM stations WHERE station_id = ?", ("AWS-01",))
            if not cur.fetchone():
                cur.execute(
                    """INSERT INTO stations (station_id, station_name, username, password_hash, latitude, longitude,
                       elevation, region, status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    ("AWS-01", "Security Test Station", "security-test-aws01", hash_password("test-password"),
                     12.97, 77.59, 920, "Test", "ACTIVE", "2026-09-28T00:00:00+00:00", "2026-09-28T00:00:00+00:00"),
                )

    def test_ingest_rejects_mismatched_station(self):
        init_db()
        payload = {
            "seq": 1,
            "device_id": "esp32-aws01-edge",
            "station_id": "AWS-99",  # mismatch
            "sensors": {"temperature": {"value": 25.0, "unit": "°C"}},
            "derived": {},
            "edge_ai": {}
        }
        response = self.client.post("/api/v1/telemetry/esp32/ingest", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertIn("Station identity violation", response.json().get("detail", ""))
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT success, detail FROM ingest_audit WHERE station_id = ? ORDER BY id DESC LIMIT 1", ("AWS-99",))
            audit = cur.fetchone()
        self.assertEqual(audit["success"], 0)
        self.assertEqual(audit["detail"], "Station identity mismatch")

    def test_timestamp_parser_raises_on_invalid(self):
        with self.assertRaises(ValueError):
            parse_iso_or_datetime("invalid-timestamp")

    def test_device_key_is_station_scoped_and_hashed_at_rest(self):
        from unittest.mock import patch

        provision = self.client.post(
            "/api/v1/admin/stations/AWS-01/device-key",
            headers=self.admin_headers,
        )
        self.assertEqual(provision.status_code, 200)
        key = provision.json()["device_key"]
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT device_key_hash FROM stations WHERE station_id = ?", ("AWS-01",))
            self.assertNotEqual(cur.fetchone()["device_key_hash"], key)

        payload = {
            "seq": 2,
            "device_id": "esp32-aws01-edge",
            "station_id": "AWS-01",
            "sensors": {"temperature": {"value": 25.0}, "humidity": {"value": 60.0}, "pressure": {"value": 1010.0}},
            "derived": {},
            "edge_ai": {},
        }
        with patch.object(telemetry_module.weather_service, "process_esp32_frame", return_value={"success": True}):
            accepted = self.client.post(
                "/api/v1/telemetry/esp32/ingest", json=payload,
                headers={"X-Station-Key": key},
            )
        self.assertEqual(accepted.status_code, 200)

        payload["station_id"] = "AWS-99"
        rejected = self.client.post(
            "/api/v1/telemetry/esp32/ingest", json=payload,
            headers={"X-Station-Key": key},
        )
        self.assertEqual(rejected.status_code, 401)

    def test_protected_route_rejects_missing_and_invalid_tokens(self):
        missing = self.client.get("/api/v1/stations/fleet/live")
        invalid = self.client.get(
            "/api/v1/stations/fleet/live",
            headers={"Authorization": "Bearer definitely-invalid"},
        )
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)


def test_ingest_rate_limit_returns_429(monkeypatch):
    monkeypatch.setattr(telemetry_module, "INGEST_RATE_LIMIT", {})
    monkeypatch.setattr(telemetry_module, "RATE_LIMIT_MAX", 1)
    monkeypatch.setattr(telemetry_module, "RATE_LIMIT_WINDOW", 60)
    request = Request({
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": "/ingest", "raw_path": b"/ingest",
        "query_string": b"", "headers": [], "client": ("198.51.100.12", 1234),
        "server": ("testserver", 80),
    })
    telemetry_module.enforce_rate_limit(request)
    with pytest.raises(HTTPException) as error:
        telemetry_module.enforce_rate_limit(request)
    assert error.value.status_code == 429


def test_ingest_audit_entry_is_persisted():
    init_db()
    telemetry_module.log_ingest_audit(
        "AWS-AUDIT-TEST", "device-test", {"sub": "operator", "role": "station_operator"},
        "198.51.100.13", True, "test ingest",
    )
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT station_id, success, detail FROM ingest_audit WHERE station_id = ? ORDER BY id DESC LIMIT 1", ("AWS-AUDIT-TEST",))
        row = cur.fetchone()
    assert row["station_id"] == "AWS-AUDIT-TEST"
    assert row["success"] == 1
    assert row["detail"] == "test ingest"
