from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable
from backend.storage import StorageMode, describe_storage_mode


@runtime_checkable
class Repository(Protocol):
    """Common repository surface for the storage backends.

    The current implementation still uses direct SQLite helpers in many places,
    but this protocol documents the shape that both SQLite and PostgreSQL
    adapters will eventually expose.
    """

    # Users
    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]: ...
    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]: ...
    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]: ...

    # Posts / feed
    def get_feed(self, skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None, exclude_nsfw: bool = False) -> List[Dict[str, Any]]: ...
    def create_post(self, post: Dict[str, Any]) -> None: ...
    def get_post(self, post_id: str) -> Optional[Dict[str, Any]]: ...

    # Interactions / ranking
    def store_dwell_event(self, user_id: str, post_id: str, dwell_ms: int) -> None: ...
    def record_user_interaction(
        self,
        user_id: str,
        post_id: str,
        dwell_time_ms: int,
        interaction_type: str,
        keywords: Optional[List[str]] = None,
    ) -> None: ...

    # Moderation / admin
    def add_moderation_offense(self, user_id: str, score: int, reason: str, ip_address: Optional[str] = None) -> int: ...
    def get_moderation_queue(self, limit: int = 100) -> List[Dict[str, Any]]: ...


def repository_supports_protocol(repository: object) -> bool:
    return isinstance(repository, Repository)


def create_repository(storage_mode: StorageMode, dsn: str = "") -> Optional[Repository]:
    capabilities = describe_storage_mode(storage_mode)
    if capabilities.is_postgresql_ready and dsn:
        from backend.postgres_repository import PostgresRepository

        return PostgresRepository(dsn)
    return None
