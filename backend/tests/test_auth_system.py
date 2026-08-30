import os
import sys
import unittest
import tempfile
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Use isolated temp database for test runner
temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp_db_path = temp_db.name
temp_db.close()
os.environ["SKYGUARD_DB_PATH"] = temp_db_path

from backend.app.storage.database import init_db, get_db
from backend.app.auth.security import hash_password, verify_password, create_access_token, decode_access_token
from backend.app.api.v1.auth import login_admin, login_station, AdminLoginRequest, StationLoginRequest
from backend.app.api.v1.stations import (
    create_station, list_stations_admin, get_station_by_id,
    toggle_station_status, reset_station_password,
    CreateStationRequest, StatusToggleRequest, ResetPasswordRequest
)
from fastapi import HTTPException

class TestSkyGuardAuthSystem(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM stations WHERE station_id = ?", ("AWS-88",))
            pwd_hash = hash_password("sentinel2026")
            now_iso = "2026-08-01T00:00:00Z"
            test_stations = [
                ("AWS-07", "Hyderabad Deccan Plateau", "operator_hyd"),
                ("AWS-12", "Mumbai Coastal Radar", "operator_mum"),
                ("AWS-19", "Cherrapunji Hill Observatory", "operator_cherra"),
                ("AWS-04", "Bengaluru Tech Plateau", "operator_blr"),
                ("AWS-21", "Leh High-Altitude Base", "operator_leh"),
                ("AWS-15", "Pune Western Ghats Inflow", "operator_pune"),
                ("AWS-09", "Kolkata Delta Marine", "operator_kol"),
            ]
            for st_id, st_name, uname in test_stations:
                cur.execute("SELECT id FROM stations WHERE station_id = ?", (st_id,))
                if not cur.fetchone():
                    cur.execute("""
                        INSERT INTO stations (station_id, station_name, username, password_hash, access_key, latitude, longitude, elevation, region, status, created_by, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'sentinel2026', 17.0, 78.0, 500, 'Test Region', 'ACTIVE', 'test', ?, ?)
                    """, (st_id, st_name, uname, pwd_hash, now_iso, now_iso))
                else:
                    cur.execute("""
                        UPDATE stations SET username = ?, password_hash = ?, status = 'ACTIVE' WHERE station_id = ?
                    """, (uname, pwd_hash, st_id))

    @classmethod
    def tearDownClass(cls):
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM stations WHERE station_id IN ('AWS-88', 'AWS-07', 'AWS-12', 'AWS-19', 'AWS-04', 'AWS-21', 'AWS-15', 'AWS-09')")
        except Exception:
            pass
        try:
            os.remove(temp_db_path)
        except Exception:
            pass

    def test_01_database_and_admin_initialization(self):
        from backend.app.config import IS_POSTGRES
        with get_db() as conn:
            cursor = conn.cursor()
            if IS_POSTGRES:
                cursor.execute("SELECT table_name as name FROM information_schema.tables WHERE table_schema='public';")
            else:
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row["name"] for row in cursor.fetchall()]
            self.assertIn("admins", tables)
            self.assertIn("stations", tables)
            self.assertIn("models", tables)
            self.assertIn("auth_audit_logs", tables)
            
            cursor.execute("SELECT * FROM admins WHERE username='admin'")
            admin = cursor.fetchone()
            self.assertIsNotNone(admin)
            self.assertEqual(admin["status"], "ACTIVE")
            self.assertTrue(admin["password_hash"].startswith("pbkdf2:sha256:100000$"))
            self.assertTrue(verify_password("sentinel2026", admin["password_hash"]))

            # Verify auto-seeded preset stations
            cursor.execute("SELECT COUNT(*) as cnt FROM stations")
            self.assertGreaterEqual(cursor.fetchone()["cnt"], 8)

    def test_02_admin_login_success_and_failure(self):
        """Test Admin login with correct and incorrect credentials"""
        res = login_admin(AdminLoginRequest(username="admin", password="sentinel2026"))
        self.assertTrue(res.success)
        self.assertEqual(res.role, "admin")
        self.assertIsNotNone(res.token)
        
        payload = decode_access_token(res.token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["role"], "admin")
        self.assertEqual(payload["sub"], "admin")
        
        with self.assertRaises(HTTPException) as ctx:
            login_admin(AdminLoginRequest(username="admin", password="wrongpassword"))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_03_admin_create_station_and_uniqueness(self):
        """Test Station creation by Admin and duplicate prevention"""
        admin_user = {"sub": "admin", "role": "admin"}
        
        req = CreateStationRequest(
            station_id="AWS-88",
            station_name="Shimla High Ridge",
            username="operator_shimla",
            password="securePassword@2026",
            latitude=31.1048,
            longitude=77.1734,
            elevation=2276.0,
            region="Western Himalayas",
            status="ACTIVE"
        )
        created = create_station(req, admin_user=admin_user)
        self.assertEqual(created.station_id, "AWS-88")
        self.assertEqual(created.username, "operator_shimla")
        
        # Verify password is NOT in response
        self.assertFalse(hasattr(created, "password_hash"))
        self.assertFalse(hasattr(created, "password"))
        
        # Verify in DB that password is salted hash
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT password_hash FROM stations WHERE station_id = 'AWS-88'")
            st_db = cursor.fetchone()
            self.assertIsNotNone(st_db)
            self.assertTrue(st_db["password_hash"].startswith("pbkdf2:sha256:100000$"))
            self.assertNotIn("securePassword@2026", st_db["password_hash"])
            self.assertTrue(verify_password("securePassword@2026", st_db["password_hash"]))
        
        # Duplicate station_id rejection
        with self.assertRaises(HTTPException) as ctx:
            create_station(CreateStationRequest(
                station_id="AWS-88",
                station_name="Duplicate Tower",
                username="operator_other",
                password="password123",
                latitude=18.0,
                longitude=79.0
            ), admin_user=admin_user)
        self.assertEqual(ctx.exception.status_code, 409)
        
        # Duplicate username rejection
        with self.assertRaises(HTTPException) as ctx:
            create_station(CreateStationRequest(
                station_id="AWS-99",
                station_name="Another Tower",
                username="operator_shimla",
                password="password123",
                latitude=18.0,
                longitude=79.0
            ), admin_user=admin_user)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_04_station_login_and_deactivation(self):
        """Test Station login, token payload, and deactivated state rejection"""
        # Login with auto-seeded preset AWS-07
        res = login_station(StationLoginRequest(username="operator_hyd", password="sentinel2026"))
        self.assertTrue(res.success)
        self.assertEqual(res.role, "station_operator")
        self.assertEqual(res.user.assignedStationId, "AWS-07")
        
        # Login with station_id
        res2 = login_station(StationLoginRequest(username="AWS-07", password="sentinel2026"))
        self.assertTrue(res2.success)
        
        # Bad password
        with self.assertRaises(HTTPException) as ctx:
            login_station(StationLoginRequest(username="operator_hyd", password="badpassword"))
        self.assertEqual(ctx.exception.status_code, 401)
        
        # Deactivate station
        admin_user = {"sub": "admin", "role": "admin"}
        toggle_station_status("AWS-07", StatusToggleRequest(status="INACTIVE"), admin_user=admin_user)
        
        # Deactivated login rejection
        with self.assertRaises(HTTPException) as ctx:
            login_station(StationLoginRequest(username="operator_hyd", password="sentinel2026"))
        self.assertEqual(ctx.exception.status_code, 403)
        
        # Reactivate station
        toggle_station_status("AWS-07", StatusToggleRequest(status="ACTIVE"), admin_user=admin_user)
        res3 = login_station(StationLoginRequest(username="operator_hyd", password="sentinel2026"))
        self.assertTrue(res3.success)

    def test_05_station_identity_isolation(self):
        """Test that Station A cannot access Station B's protected data"""
        admin_user = {"sub": "admin", "role": "admin"}
        
        # Station A identity (AWS-07)
        station_a_token = {"sub": "operator_hyd", "role": "station_operator", "station_id": "AWS-07"}
        
        # Station A accessing Station A -> Allowed
        st_a_profile = get_station_by_id("AWS-07", current_user=station_a_token)
        self.assertEqual(st_a_profile.station_id, "AWS-07")
        
        # Station A attempting to access Station B (AWS-12) -> Rejected 403
        with self.assertRaises(HTTPException) as ctx:
            get_station_by_id("AWS-12", current_user=station_a_token)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Station identity violation", ctx.exception.detail)
        
        # Admin accessing Station B -> Allowed
        st_b_profile = get_station_by_id("AWS-12", current_user=admin_user)
        self.assertEqual(st_b_profile.station_id, "AWS-12")

    def test_06_admin_list_and_password_reset(self):
        """Test Admin station list retrieval and secure password reset"""
        admin_user = {"sub": "admin", "role": "admin"}
        
        stations_list = list_stations_admin(admin_user=admin_user)
        self.assertGreaterEqual(len(stations_list), 8)
        station_ids = [s.station_id for s in stations_list]
        self.assertIn("AWS-07", station_ids)
        self.assertIn("AWS-12", station_ids)
        
        # Reset Station A password
        reset_res = reset_station_password("AWS-88", ResetPasswordRequest(new_password="newResetPass@2026"), admin_user=admin_user)
        self.assertTrue(reset_res["success"])
        
        # Old password fails
        with self.assertRaises(HTTPException) as ctx:
            login_station(StationLoginRequest(username="operator_shimla", password="securePassword@2026"))
        self.assertEqual(ctx.exception.status_code, 401)
        
        # New password succeeds
        new_login = login_station(StationLoginRequest(username="operator_shimla", password="newResetPass@2026"))
        self.assertTrue(new_login.success)

if __name__ == "__main__":
    unittest.main(verbosity=2)
