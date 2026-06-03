from backend.storage import describe_storage_mode


def test_storage_capabilities_for_sqlite():
    capabilities = describe_storage_mode("sqlite")

    assert capabilities.is_sqlite is True
    assert capabilities.is_postgresql_ready is False
    assert capabilities.has_persistent_storage is True
    assert capabilities.can_use_sqlite_schema is True


def test_storage_capabilities_for_postgresql_ready():
    capabilities = describe_storage_mode("postgresql-ready")

    assert capabilities.is_sqlite is False
    assert capabilities.is_postgresql_ready is True
    assert capabilities.has_persistent_storage is True
    assert capabilities.can_use_sqlite_schema is True
