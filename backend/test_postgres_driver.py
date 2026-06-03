from backend.postgres_driver import normalize_postgres_dsn, postgres_driver_available


def test_normalize_postgres_dsn_strips_whitespace():
    assert normalize_postgres_dsn("  postgresql://localhost/app  ") == "postgresql://localhost/app"


def test_postgres_driver_available_returns_boolean():
    assert isinstance(postgres_driver_available(), bool)
