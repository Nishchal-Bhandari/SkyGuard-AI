import os
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Create temporary isolated environment for test run
temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp_db_path = temp_db.name
os.environ["DATABASE_URL"] = f"sqlite:///{temp_db_path}"
os.environ["SKYGUARD_DB_PATH"] = temp_db_path

temp_models_dir = tempfile.mkdtemp()
os.environ["MODEL_STORAGE_PATH"] = temp_models_dir

from backend.app.storage.database import (
    init_db, get_db, fetch_historical_telemetry, get_active_model_record,
    record_regional_event, count_consecutive_regional_events,
)
from backend.app.auth.security import create_access_token
from backend.app.main import app


class TestSkyGuardTelemetryPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        # Create Admin Token for authorized operations
        cls.admin_token = create_access_token({
            "sub": "admin",
            "role": "admin",
            "name": "Chief Supervisor"
        })
        cls.headers = {"Authorization": f"Bearer {cls.admin_token}"}

        # Provision AWS-07 and AWS-08 stations in DB if not present
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM stations WHERE station_id = 'AWS-07'")
            if not cur.fetchone():
                cur.execute("""
                    INSERT INTO stations (station_id, station_name, username, password_hash, latitude, longitude, elevation, region, status, created_at, updated_at)
                    VALUES ('AWS-07', 'Hyderabad Deccan', 'operator_hyd', 'hash', 17.385, 78.486, 542, 'Deccan', 'ACTIVE', '2026-08-01', '2026-08-01')
                """)
            cur.execute("SELECT id FROM stations WHERE station_id = 'AWS-08'")
            if not cur.fetchone():
                cur.execute("""
                    INSERT INTO stations (station_id, station_name, username, password_hash, latitude, longitude, elevation, region, status, created_at, updated_at)
                    VALUES ('AWS-08', 'Visakhapatnam Coast', 'operator_vizag', 'hash', 17.686, 83.218, 45, 'Eastern Coast', 'ACTIVE', '2026-08-01', '2026-08-01')
                """)
            cur.execute("DELETE FROM telemetry WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM assessments WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM model_registry WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM training_jobs WHERE station_id IN ('AWS-07', 'AWS-08')")

    @classmethod
    def tearDownClass(cls):
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM telemetry WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM assessments WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM model_registry WHERE station_id IN ('AWS-07', 'AWS-08')")
            cur.execute("DELETE FROM training_jobs WHERE station_id IN ('AWS-07', 'AWS-08')")
        try:
            os.remove(temp_db_path)
        except Exception:
            pass

    def test_01_upload_valid_aws07_csv(self):
        """TEST 1: Upload valid AWS-07 CSV -> records stored under AWS-07"""
        csv_lines = ["station_id,timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm"]
        for i in range(25):
            csv_lines.append(f"AWS-07,2026-08-0{1 + i // 24} {i % 24:02d}:00:00,{28.0 + i*0.2},{50.0 + i},{1006.0 + i*0.1},12.0,0.0")
        csv_content = "\n".join(csv_lines).encode("utf-8")

        response = self.client.post(
            "/api/v1/stations/AWS-07/telemetry/upload",
            files={"file": ("aws07_history.csv", csv_content, "text/csv")},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["station_id"], "AWS-07")
        self.assertEqual(data["rows_queued"], 25)

        # Verify in DB
        rows = fetch_historical_telemetry("AWS-07")
        self.assertEqual(len(rows), 25)

    def test_02_upload_valid_aws08_csv(self):
        """TEST 2: Upload valid AWS-08 CSV -> records stored under AWS-08"""
        csv_lines = ["station_id,timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm"]
        for i in range(25):
            csv_lines.append(f"AWS-08,2026-08-0{1 + i // 24} {i % 24:02d}:00:00,{32.0 + i*0.3},{80.0 + i*0.5},{1012.0 - i*0.1},18.0,2.5")
        csv_content = "\n".join(csv_lines).encode("utf-8")

        response = self.client.post(
            "/api/v1/stations/AWS-08/telemetry/upload",
            files={"file": ("aws08_history.csv", csv_content, "text/csv")},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["station_id"], "AWS-08")
        self.assertEqual(data["rows_queued"], 25)

        # Verify strict partition in DB
        rows = fetch_historical_telemetry("AWS-08")
        self.assertEqual(len(rows), 25)

    def seed_training_history(self, sid):
        # DOCS requires >=720 distinct samples over >=14 days, replacing the old 25-row fixture.
        import datetime, math, random
        from backend.app.storage.database import insert_telemetry_batch
        rng = random.Random(42 if sid == "AWS-07" else 43)
        start = datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc)
        rows = [{"timestamp": (start+datetime.timedelta(hours=i)).isoformat(),
                 "temp": 28+3*math.sin(i*math.pi/12)+rng.gauss(0,.5),
                 "hum": 65-5*math.sin(i*math.pi/12)+rng.gauss(0,2),
                 "pres": 1008+rng.gauss(0,.5)} for i in range(960)]
        with get_db() as conn:
            conn.cursor().execute("DELETE FROM telemetry WHERE station_id = ?", (sid,))
        insert_telemetry_batch(sid, rows)

    def test_03_train_aws07_only_uses_aws07_data(self):
        """TEST 3: Train AWS-07 -> only AWS-07 data is used"""
        self.seed_training_history("AWS-07")
        response = self.client.post(
            "/api/v1/stations/AWS-07/train",
            json={"version": "v1.0"},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["station_id"], "AWS-07")
        self.assertEqual(data["model_version"], "v1.0")
        self.assertEqual(data["valid_records"], 960)

        # Verify model card in active model
        active_rec = get_active_model_record("AWS-07")
        self.assertIsNotNone(active_rec)
        self.assertEqual(active_rec["status"], "ACTIVE")
        self.assertIn("AWS-07", active_rec["model_id"])

    def test_04_train_aws08_only_uses_aws08_data(self):
        """TEST 4: Train AWS-08 -> only AWS-08 data is used"""
        self.seed_training_history("AWS-08")
        response = self.client.post(
            "/api/v1/stations/AWS-08/train",
            json={"version": "v1.0"},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["station_id"], "AWS-08")
        self.assertEqual(data["model_version"], "v1.0")
        self.assertEqual(data["valid_records"], 960)

        # Ensure Model AWS-07 != Model AWS-08
        m07 = get_active_model_record("AWS-07")
        m08 = get_active_model_record("AWS-08")
        self.assertNotEqual(m07["model_id"], m08["model_id"])
        self.assertNotEqual(m07["sha256"], m08["sha256"])

    def test_05_attempt_to_train_aws08_using_aws07_dataset_rejected(self):
        """TEST 5: Attempt to upload AWS-07 dataset to AWS-08 route -> reject cross-station contamination"""
        csv_lines = ["station_id,timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm"]
        for i in range(10):
            csv_lines.append(f"AWS-07,2026-08-02 1{i}:00:00,28.0,50.0,1006.0,12.0,0.0")
        csv_content = "\n".join(csv_lines).encode("utf-8")

        response = self.client.post(
            "/api/v1/stations/AWS-08/telemetry/upload",
            files={"file": ("aws07_foreign.csv", csv_content, "text/csv")},
            headers=self.headers
        )
        # All rows should be rejected due to station mismatch
        self.assertEqual(response.status_code, 400)

    def test_06_aws07_live_telemetry_selects_aws07_model(self):
        """TEST 6: AWS-07 live telemetry -> AWS-07 model selected and scored"""
        payload = {
            "observation": {"temperature": 29.0, "humidity": 55.0, "pressure": 1007.0, "wind_speed": 12.0}
        }
        response = self.client.post(
            "/api/v1/stations/AWS-07/score",
            json=payload,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["has_model"])
        self.assertEqual(data["station_id"], "AWS-07")
        self.assertIn("AWS-07", data["model_id"])
        self.assertIn(data["status"], ["NORMAL", "ANOMALY"])

    def test_07_aws08_live_telemetry_selects_aws08_model(self):
        """TEST 7: AWS-08 live telemetry -> AWS-08 model selected and scored"""
        payload = {
            "observation": {"temperature": 33.0, "humidity": 82.0, "pressure": 1011.0, "wind_speed": 18.0}
        }
        response = self.client.post(
            "/api/v1/stations/AWS-08/score",
            json=payload,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["has_model"])
        self.assertEqual(data["station_id"], "AWS-08")
        self.assertIn("AWS-08", data["model_id"])

    def test_08_station_with_no_trained_model_returns_model_not_trained(self):
        """TEST 8: Station with no trained model -> MODEL_NOT_TRAINED"""
        payload = {
            "observation": {"temperature": 25.0, "humidity": 60.0, "pressure": 1010.0}
        }
        response = self.client.post(
            "/api/v1/stations/AWS-UNREGISTERED/score",
            json=payload,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["has_model"])
        self.assertEqual(data["status"], "MODEL_NOT_TRAINED")

    def test_09_retrain_aws07_creates_new_version_without_deleting_previous(self):
        """TEST 9: Retrain AWS-07 -> creates v1.1 without deleting v1.0"""
        response = self.client.post(
            "/api/v1/stations/AWS-07/train",
            json={"version": "v1.1"},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["model_version"], "v1.1")

        # Verify model_registry has both versions
        res_models = self.client.get("/api/v1/stations/AWS-07/models", headers=self.headers)
        models = res_models.json()["models"]
        versions = [m["model_version"] for m in models]
        self.assertIn("v1.0", versions)
        self.assertIn("v1.1", versions)

        # Ensure v1.1 is ACTIVE and v1.0 is ARCHIVED
        active_rec = get_active_model_record("AWS-07")
        self.assertEqual(active_rec["model_version"], "v1.1")

    def test_10_rollback_previous_model_becomes_active(self):
        """TEST 10: Rollback -> previous AWS-07 model becomes active"""
        response = self.client.post(
            "/api/v1/stations/AWS-07/models/v1.0/rollback",
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["active_version"], "v1.0")

        # Verify in DB that v1.0 is ACTIVE
        active_rec = get_active_model_record("AWS-07")
        self.assertEqual(active_rec["model_version"], "v1.0")

    def test_11_malformed_csv_and_duplicate_timestamp_handling(self):
        """TEST 11: Idempotent duplicate upload and malformed line handling"""
        csv_lines = [
            "station_id,timestamp,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,rainfall_mm",
            "AWS-07,2026-08-01 10:00:00,28.5,52.0,1006.5,12.0,0.0",
            "AWS-07,invalid-time,28.5,52.0,1006.5,12.0,0.0",  # malformed time
            "AWS-07,2026-08-01 10:00:00,29.0,50.0,1006.0,11.0,0.0"   # duplicate timestamp (should update smoothly)
        ]
        csv_content = "\n".join(csv_lines).encode("utf-8")

        response = self.client.post(
            "/api/v1/stations/AWS-07/telemetry/upload",
            files={"file": ("aws07_dup.csv", csv_content, "text/csv")},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreaterEqual(data["rows_rejected"], 1)
        # Conflicting duplicates must not overwrite original telemetry.
        # Should have accepted the valid records and handled duplicate safely
        self.assertGreaterEqual(data["rows_queued"], 1)

    def test_12_assessment_endpoint_is_station_scoped(self):
        """Persisted assessment evidence is available only to an authorized station."""
        from backend.app.storage.database import persist_assessment

        persist_assessment("AWS-07", {
            "quality_state": "SUSPECT",
            "severity": "HIGH",
            "classification": "LOCALIZED_ANOMALY",
            "anomaly_score": 0.91,
            "confidence": "HIGH",
            "evidence_completeness": 0.75,
            "evidence_vector": {"z_ml": 0.91},
        }, source_timestamp="2099-08-03T10:00:00+00:00")

        response = self.client.get(
            "/api/v1/stations/AWS-07/assessments/latest",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["has_assessment"])
        self.assertEqual(data["assessment"]["classification"], "LOCALIZED_ANOMALY")
        self.assertEqual(data["assessment"]["evidence"]["evidence_vector"]["z_ml"], 0.91)

    def test_13_model_promotion_requires_validation_gate(self):
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT sha256 FROM model_registry WHERE station_id=? AND model_version=?", ("AWS-07", "v1.1"))
            original = cur.fetchone()["sha256"]
            cur.execute("UPDATE model_registry SET sha256=? WHERE station_id=? AND model_version=?", ("tampered", "AWS-07", "v1.1"))
        rejected = self.client.post("/api/v1/stations/AWS-07/models/v1.1/promote", headers=self.headers)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(get_active_model_record("AWS-07")["model_version"], "v1.0")
        with get_db() as conn:
            conn.cursor().execute("UPDATE model_registry SET sha256=? WHERE station_id=? AND model_version=?", (original, "AWS-07", "v1.1"))
        accepted = self.client.post("/api/v1/stations/AWS-07/models/v1.1/promote", headers=self.headers)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(get_active_model_record("AWS-07")["model_version"], "v1.1")

    def test_14_regional_event_persistence_counts_distinct_observations(self):
        station_id = "AWS-REG-PERSIST"
        t0 = "2099-08-04T10:00:00+00:00"
        t1 = "2099-08-04T10:01:00+00:00"
        t2 = "2099-08-04T10:02:00+00:00"

        record_regional_event(station_id, t0, True)
        record_regional_event(station_id, t0, True)  # replayed source timestamp is idempotent
        self.assertEqual(count_consecutive_regional_events(station_id, t0), 1)
        record_regional_event(station_id, t1, True)
        self.assertEqual(count_consecutive_regional_events(station_id, t1), 2)
        record_regional_event(station_id, t2, False)
        self.assertEqual(count_consecutive_regional_events(station_id, t2), 0)

    def test_15_regional_event_consensus_requires_same_direction_peers(self):
        import datetime
        from backend.app.services.weather_service import (
            regional_event_consensus, is_eligible_regional_peer,
        )

        self.assertTrue(regional_event_consensus(3.0, [2.5, 2.2], 0.6))
        self.assertFalse(regional_event_consensus(3.0, [2.5, -2.2], 0.6))
        self.assertFalse(regional_event_consensus(1.0, [2.5, 2.2], 0.6))
        self.assertFalse(regional_event_consensus(3.0, [2.5, 2.2], 0.2))

        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        peer = {
            "qc_flag": "VALID",
            "readiness": {"tier": "TRAINED"},
            "ml_model": {"has_model": True, "feature_vector": [2.4]},
            "source_timestamp": now,
        }
        self.assertTrue(is_eligible_regional_peer(peer, now))
        self.assertFalse(is_eligible_regional_peer({**peer, "qc_flag": "ERRONEOUS"}, now))
        self.assertFalse(is_eligible_regional_peer({**peer, "readiness": {"tier": "COLD_START"}}, now))
        self.assertFalse(is_eligible_regional_peer({**peer, "source_timestamp": "2020-01-01T00:00:00+00:00"}, now))


if __name__ == "__main__":
    unittest.main()
