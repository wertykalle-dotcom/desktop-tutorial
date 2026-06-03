from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.postgres_driver import fetch_all_postgres, fetch_one_postgres, postgres_driver_available


class PostgresRepository:
    def __init__(self, dsn: str):
        self.dsn = dsn.strip()

    def _ensure_available(self) -> None:
        if not postgres_driver_available():
            raise RuntimeError("psycopg is not installed; PostgreSQL repository is unavailable")

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        self._ensure_available()
        return fetch_one_postgres(self.dsn, "SELECT * FROM users WHERE email = %(email)s LIMIT 1", {"email": email})

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_available()
        return fetch_one_postgres(self.dsn, "SELECT * FROM users WHERE user_id = %(user_id)s LIMIT 1", {"user_id": user_id})

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        self._ensure_available()
        return fetch_one_postgres(self.dsn, "SELECT * FROM users WHERE username = %(username)s LIMIT 1", {"username": username})

    def get_feed(self, skip: int = 0, limit: int = 20, user_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        self._ensure_available()
        where_clause = ""
        params: Dict[str, Any] = {"limit": limit, "skip": skip}
        if user_ids:
            where_clause = "WHERE user_id = ANY(%(user_ids)s)"
            params["user_ids"] = user_ids
        return fetch_all_postgres(
            self.dsn,
            f"SELECT * FROM posts {where_clause} ORDER BY created_at DESC LIMIT %(limit)s OFFSET %(skip)s",
            params,
        )

    def create_post(self, post: Dict[str, Any]) -> None:
        self._ensure_available()
        fetch_all_postgres(
            self.dsn,
            """
            INSERT INTO posts (post_id, user_id, username, profile_picture, text, image, likes_count, comments_count, created_at, keywords)
            VALUES (%(post_id)s, %(user_id)s, %(username)s, %(profile_picture)s, %(text)s, %(image)s, %(likes_count)s, %(comments_count)s, %(created_at)s, %(keywords)s)
            """,
            post,
        )

    def get_post(self, post_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_available()
        return fetch_one_postgres(self.dsn, "SELECT * FROM posts WHERE post_id = %(post_id)s LIMIT 1", {"post_id": post_id})

    def store_dwell_event(self, user_id: str, post_id: str, dwell_ms: int) -> None:
        self._ensure_available()
        fetch_all_postgres(
            self.dsn,
            """
            INSERT INTO dwell_events (dwell_id, user_id, post_id, dwell_ms, created_at)
            VALUES (%(dwell_id)s, %(user_id)s, %(post_id)s, %(dwell_ms)s, %(created_at)s)
            """,
            {
                "dwell_id": f"dwell_{user_id}_{post_id}",
                "user_id": user_id,
                "post_id": post_id,
                "dwell_ms": dwell_ms,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def record_user_interaction(
        self,
        user_id: str,
        post_id: str,
        dwell_time_ms: int,
        interaction_type: str,
        keywords: Optional[List[str]] = None,
    ) -> None:
        self._ensure_available()
        fetch_all_postgres(
            self.dsn,
            """
            INSERT INTO UserInteractions (interaction_id, user_id, post_id, dwell_time_ms, interaction_type, keywords, created_at)
            VALUES (%(interaction_id)s, %(user_id)s, %(post_id)s, %(dwell_time_ms)s, %(interaction_type)s, %(keywords)s, %(created_at)s)
            """,
            {
                "interaction_id": f"interaction_{user_id}_{post_id}",
                "user_id": user_id,
                "post_id": post_id,
                "dwell_time_ms": dwell_time_ms,
                "interaction_type": interaction_type,
                "keywords": keywords or [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def add_moderation_offense(self, user_id: str, score: int, reason: str, ip_address: Optional[str] = None) -> int:
        self._ensure_available()
        fetch_all_postgres(
            self.dsn,
            """
            INSERT INTO moderation_offenses (offense_id, user_id, score, reason, ip_address, created_at)
            VALUES (%(offense_id)s, %(user_id)s, %(score)s, %(reason)s, %(ip_address)s, %(created_at)s)
            """,
            {
                "offense_id": f"offense_{user_id}",
                "user_id": user_id,
                "score": score,
                "reason": reason,
                "ip_address": ip_address,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        row = fetch_one_postgres(
            self.dsn,
            "SELECT COUNT(*) AS c FROM moderation_offenses WHERE user_id = %(user_id)s",
            {"user_id": user_id},
        )
        return int(row["c"]) if row else 0

    def get_moderation_queue(self, limit: int = 100) -> List[Dict[str, Any]]:
        self._ensure_available()
        return fetch_all_postgres(
            self.dsn,
            "SELECT * FROM moderation_queue ORDER BY created_at DESC LIMIT %(limit)s",
            {"limit": limit},
        )
