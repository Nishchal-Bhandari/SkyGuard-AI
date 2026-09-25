import os
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp_db_path = temp_db.name
os.environ.setdefault("DATABASE_URL", f"sqlite:///{temp_db_path}")
os.environ.setdefault("SKYGUARD_DB_PATH", temp_db_path)

from backend.app.storage.database import init_db, get_db, create_or_update_incident
from backend.app.auth.security import create_access_token
from backend.app.main import app


class TestIncidentDeletionAndMaintenance(unittest.TestCase):
    ADMIN_STATION = "AWS-77"
    OPERATOR_STATION = "AWS-78"

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.admin_token = create_access_token({"sub": "admin", "role": "admin", "name": "Chief Supervisor"})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}
        cls.operator_token = create_access_token({
            "sub": "operator_77", "role": "station_operator", "station_id": cls.ADMIN_STATION, "name": "Field Operator"
        })
        cls.operator_headers = {"Authorization": f"Bearer {cls.operator_token}"}

        with get_db() as conn:
            cur = conn.cursor()
            for st_id, uname in [(cls.ADMIN_STATION, "operator_77"), (cls.OPERATOR_STATION, "operator_78")]:
                cur.execute("SELECT id FROM stations WHERE station_id = ?", (st_id,))
                if not cur.fetchone():
                    cur.execute("""
                        INSERT INTO stations (station_id, station_name, username, password_hash, latitude, longitude, elevation, region, status, created_at, updated_at)
                        VALUES (?, ?, ?, 'hash', 17.0, 78.0, 500, 'Test Region', 'ACTIVE', '2026-08-01', '2026-08-01')
                    """, (st_id, f"{st_id} Test Unit", uname))
            cur.execute("DELETE FROM incidents WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
            cur.execute("DELETE FROM maintenance_tasks WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
            cur.execute("DELETE FROM maintenance_audit WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))

    @classmethod
    def tearDownClass(cls):
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM incidents WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
            cur.execute("DELETE FROM maintenance_tasks WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
            cur.execute("DELETE FROM maintenance_audit WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
            cur.execute("DELETE FROM stations WHERE station_id IN (?, ?)", (cls.ADMIN_STATION, cls.OPERATOR_STATION))
        try:
            os.remove(temp_db_path)
        except Exception:
            pass

    def _seed_incident(self, station_id):
        return create_or_update_incident({
            "station_id": station_id,
            "station_name": f"{station_id} Test Unit",
            "variable": "air_temperature",
            "severity": "high",
            "fault_risk": 0.9,
            "quality_state": "LOCALIZED_ANOMALY",
            "reason_codes": ["TEST_INJECTED"],
            "explanation": "Synthetic test incident",
            "recommended_actions": ["Inspect sensor"],
            "evidence_ids": [],
            "evidence_data": {},
        })

    # ---- Incident deletion actually removes rows from the database ----

    def test_01_station_operator_cannot_delete_incidents(self):
        self._seed_incident(self.ADMIN_STATION)
        response = self.client.delete("/api/v1/incidents", headers=self.operator_headers)
        self.assertEqual(response.status_code, 403)

        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS c FROM incidents WHERE station_id = ?", (self.ADMIN_STATION,))
            self.assertGreaterEqual(int(cur.fetchone()["c"]), 1)

    def test_02_admin_scoped_delete_removes_only_target_station_rows(self):
        self._seed_incident(self.ADMIN_STATION)
        self._seed_incident(self.OPERATOR_STATION)

        response = self.client.delete(
            f"/api/v1/incidents?station_id={self.ADMIN_STATION}",
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertGreaterEqual(data["cleared_count"], 1)

        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS c FROM incidents WHERE station_id = ?", (self.ADMIN_STATION,))
            self.assertEqual(int(cur.fetchone()["c"]), 0)
            cur.execute("SELECT COUNT(*) AS c FROM incidents WHERE station_id = ?", (self.OPERATOR_STATION,))
            self.assertGreaterEqual(int(cur.fetchone()["c"]), 1)

    def test_03_admin_global_delete_removes_all_rows(self):
        self._seed_incident(self.ADMIN_STATION)

        response = self.client.delete("/api/v1/incidents", headers=self.admin_headers)
        self.assertEqual(response.status_code, 200)

        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS c FROM incidents WHERE station_id IN (?, ?)", (self.ADMIN_STATION, self.OPERATOR_STATION))
            self.assertEqual(int(cur.fetchone()["c"]), 0)

        # A subsequent fetch must reflect the true empty database state, not stale cache.
        list_response = self.client.get("/api/v1/incidents", headers=self.admin_headers)
        self.assertEqual(list_response.status_code, 200)
        ids = [i["station_id"] for i in list_response.json()["incidents"]]
        self.assertNotIn(self.ADMIN_STATION, ids)
        self.assertNotIn(self.OPERATOR_STATION, ids)

    # ---- Field Maintenance & Sensor Calibration ----

    def test_04_maintenance_tasks_seed_defaults_on_first_access(self):
        response = self.client.get(f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/tasks", headers=self.admin_headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["tasks"]), 6)
        self.assertTrue(all(t["done"] is False for t in data["tasks"]))

    def test_05_patch_task_persists_across_requests(self):
        response = self.client.patch(
            f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/tasks/chk-1",
            json={"done": True},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        updated = next(t for t in response.json()["tasks"] if t["task_key"] == "chk-1")
        self.assertTrue(updated["done"])
        self.assertIsNotNone(updated["completed_at"])

        # Re-fetch independently to prove it was written to the database, not just returned.
        refetch = self.client.get(f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/tasks", headers=self.admin_headers)
        refetched_task = next(t for t in refetch.json()["tasks"] if t["task_key"] == "chk-1")
        self.assertTrue(refetched_task["done"])

    def test_06_unknown_task_key_returns_404(self):
        response = self.client.patch(
            f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/tasks/not-a-real-task",
            json={"done": True},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_07_operator_cannot_access_other_station_maintenance(self):
        response = self.client.get(
            f"/api/v1/stations/{self.OPERATOR_STATION}/maintenance/tasks",
            headers=self.operator_headers,
        )
        self.assertEqual(response.status_code, 403)

    def test_08_submit_signs_audit_with_completion_snapshot(self):
        response = self.client.post(
            f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/submit",
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        audit = response.json()["audit"]
        self.assertEqual(audit["tasks_total"], 6)
        self.assertGreaterEqual(audit["tasks_completed"], 1)
        self.assertEqual(len(audit["signature_hash"]), 64)

        history = self.client.get(
            f"/api/v1/stations/{self.ADMIN_STATION}/maintenance/history",
            headers=self.admin_headers,
        )
        self.assertEqual(history.status_code, 200)
        entries = history.json()["history"]
        self.assertGreaterEqual(len(entries), 1)
        self.assertEqual(entries[0]["signature_hash"], audit["signature_hash"])


if __name__ == "__main__":
    unittest.main()
