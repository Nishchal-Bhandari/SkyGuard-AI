import unittest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth.security import create_access_token
from backend.app.api.v1.telemetry import parse_iso_or_datetime

class TestESP32IngestSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        # Create a station operator token for station AWS-01
        cls.station_token = create_access_token({
            "sub": "operator_aws01",
            "role": "station_operator",
            "station_id": "AWS-01",
            "name": "Station Operator"
        })
        cls.headers = {"Authorization": f"Bearer {cls.station_token}"}

    def test_ingest_rejects_mismatched_station(self):
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

    def test_timestamp_parser_raises_on_invalid(self):
        with self.assertRaises(ValueError):
            parse_iso_or_datetime("invalid-timestamp")
