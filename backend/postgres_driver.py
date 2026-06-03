from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional


try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - dependency is optional until installed
    psycopg = None
    dict_row = None


class PostgresDriverUnavailable(RuntimeError):
    pass


def postgres_driver_available() -> bool:
    return psycopg is not None


def normalize_postgres_dsn(dsn: str) -> str:
    return (dsn or "").strip()


@contextmanager
def connect_postgres(dsn: str) -> Iterator[Any]:
    if not postgres_driver_available():
        raise PostgresDriverUnavailable(
            "psycopg is not installed. Install the PostgreSQL driver to enable DATABASE_URL support."
        )
    connection = psycopg.connect(normalize_postgres_dsn(dsn), row_factory=dict_row)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def fetch_one_postgres(dsn: str, query: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    with connect_postgres(dsn) as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, params or {})
            row = cursor.fetchone()
            return dict(row) if row else None


def fetch_all_postgres(dsn: str, query: str, params: Optional[Dict[str, Any]] = None) -> list[Dict[str, Any]]:
    with connect_postgres(dsn) as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, params or {})
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
