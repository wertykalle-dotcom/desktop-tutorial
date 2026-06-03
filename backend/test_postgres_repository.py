from backend.repository import create_repository
from backend.postgres_repository import PostgresRepository


def test_create_repository_returns_postgres_repository_for_postgresql_ready_mode():
    repository = create_repository("postgresql-ready", dsn="postgresql://localhost/app")

    assert isinstance(repository, PostgresRepository)
