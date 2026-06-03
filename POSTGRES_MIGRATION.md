# PostgreSQL Migration Plan

The current backend is fully working with SQLite and optional MongoDB paths.
It now recognizes PostgreSQL-style `DATABASE_URL` values as a distinct storage
mode, but it is not yet backed by a PostgreSQL driver or ORM, so PostgreSQL
support still needs a storage-layer migration rather than a simple
environment-variable switch.

## What Would Need To Change

1. Introduce a PostgreSQL driver or ORM layer.
2. Replace the direct `sqlite3` calls in `backend/server.py` with repository
   helpers that can target SQLite during development and PostgreSQL in production.
3. Add schema migration support.
4. Move the current SQLite-specific state tables and indexes into migrations.
5. Update tests to run against the new abstraction.

## Suggested Rollout

1. Add a storage abstraction.
2. Keep SQLite as the default implementation.
3. Add PostgreSQL as an opt-in implementation behind `DATABASE_URL`.
4. Run backend tests against both engines.
5. Switch production to PostgreSQL only after parity is proven.

## Current Progress

- `get_storage_mode()` now distinguishes:
  - `sqlite`
  - `mongodb`
  - `postgresql-ready`
  - `external-database`
- this gives the backend a clean, explicit place to branch once the actual
  PostgreSQL engine lands
- `backend/repository.py` now defines the shared repository contract for the
  critical user, feed, interaction, and moderation paths
- `backend/postgres_driver.py` now provides an opt-in psycopg wrapper for the
  PostgreSQL implementation path once the dependency is installed

## Current Environment Variables

- `DATABASE_PATH`
  - current SQLite file path
- `DATABASE_URL`
  - reserved for the future PostgreSQL implementation

## Practical Recommendation

For now, deploy with the current SQLite volume-backed container flow or the
Mongo-backed paths already present in the backend. Move to PostgreSQL only after
the storage abstraction lands.
