import os

os.environ.setdefault("TESTING", "1")

import backend.server as server


def test_get_storage_mode_prefers_postgresql_ready_for_postgres_urls(monkeypatch):
    monkeypatch.setattr(server, "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app")
    monkeypatch.setattr(server, "SQLITE_DB_PATH", None)
    monkeypatch.setattr(server, "db", None)

    assert server.get_storage_mode() == "postgresql-ready"


def test_get_storage_mode_reports_sqlite_when_database_path_exists(monkeypatch):
    monkeypatch.setattr(server, "DATABASE_URL", "")
    monkeypatch.setattr(server, "SQLITE_DB_PATH", "/tmp/test.db")
    monkeypatch.setattr(server, "db", None)

    assert server.get_storage_mode() == "sqlite"
