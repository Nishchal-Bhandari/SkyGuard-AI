"""PostgreSQL pool recovery must never route traffic to a different database."""

import pytest
from fastapi import HTTPException

from backend.app.storage import database


class FakeConnection:
    def __init__(self, closed=False):
        self.closed = closed
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeCursor:
    def execute(self, sql):
        assert sql == "SELECT 1"

    def close(self):
        pass


class FakePool:
    def __init__(self, connections):
        self.connections = iter(connections)
        self.returned = []

    def getconn(self):
        return next(self.connections)

    def putconn(self, connection, close=False):
        self.returned.append((connection, close))


def test_stale_postgres_connection_is_discarded_and_replaced(monkeypatch):
    stale, live = FakeConnection(closed=True), FakeConnection()
    pool = FakePool([stale, live])
    monkeypatch.setattr(database, "IS_POSTGRES", True)
    monkeypatch.setattr(database, "PSYCOPG2_AVAILABLE", True)
    monkeypatch.setattr(database, "get_pg_pool", lambda: pool)

    with database.get_db() as connection:
        assert connection.is_postgres

    assert pool.returned == [(stale, True), (live, False)]
    assert live.commits == 1


def test_postgres_unavailable_fails_closed(monkeypatch):
    pool = FakePool([FakeConnection(closed=True), FakeConnection(closed=True)])
    monkeypatch.setattr(database, "IS_POSTGRES", True)
    monkeypatch.setattr(database, "PSYCOPG2_AVAILABLE", True)
    monkeypatch.setattr(database, "get_pg_pool", lambda: pool)

    with pytest.raises(RuntimeError, match="Configured PostgreSQL database unavailable"):
        with database.get_db():
            pass

    assert len(pool.returned) == 2
    assert all(close for _, close in pool.returned)


def test_health_reports_database_outage(monkeypatch):
    from backend.app import main

    def unavailable():
        raise RuntimeError("Database offline")

    monkeypatch.setattr(main, "get_db", unavailable)
    with pytest.raises(HTTPException) as error:
        main.health_check()
    assert error.value.status_code == 503
    assert error.value.detail == "Database unavailable"


def test_assessment_insert_repairs_sequence_after_legacy_id_collision():
    class DuplicateAssessmentId(Exception):
        pgcode = "23505"
        diag = type("Diagnostics", (), {"constraint_name": "assessments_pkey"})()

    class Cursor:
        def __init__(self):
            self.statements = []
            self.insert_attempts = 0

        def execute(self, sql, params=None):
            self.statements.append(sql.strip())
            if sql.strip().startswith("INSERT"):
                self.insert_attempts += 1
                if self.insert_attempts == 1:
                    raise DuplicateAssessmentId()

    cursor = Cursor()
    connection = type("Connection", (), {"is_postgres": True})()
    database.insert_assessment_with_sequence_recovery(
        connection, cursor, "INSERT INTO assessments(station_id) VALUES (?)", ("AWS-01",)
    )
    assert cursor.insert_attempts == 2
    assert any(sql.startswith("LOCK TABLE assessments") for sql in cursor.statements)
    assert any(sql.startswith("SELECT setval") for sql in cursor.statements)
