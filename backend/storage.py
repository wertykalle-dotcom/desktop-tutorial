from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


StorageMode = Literal["sqlite", "mongodb", "postgresql-ready", "external-database", "memory"]


@dataclass(frozen=True)
class StorageCapabilities:
    mode: StorageMode

    @property
    def is_sqlite(self) -> bool:
        return self.mode == "sqlite"

    @property
    def is_postgresql_ready(self) -> bool:
        return self.mode == "postgresql-ready"

    @property
    def has_persistent_storage(self) -> bool:
        return self.mode in {"sqlite", "mongodb", "postgresql-ready", "external-database"}

    @property
    def can_use_sqlite_schema(self) -> bool:
        return self.mode in {"sqlite", "postgresql-ready"}


def describe_storage_mode(mode: StorageMode) -> StorageCapabilities:
    return StorageCapabilities(mode=mode)
