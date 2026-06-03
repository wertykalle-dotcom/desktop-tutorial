# Desktop Tutorial

Monorepo for a social-style app with a Python backend and an Expo frontend.

## Current Status

- `pip` dependencies: no known gaps
- `npm` dependencies: no known gaps
- frontend tests: passing
- backend API tests: passing

## Implemented Areas

- locale detection, locale storage, and locale file loading
- RTL-aware UI behavior in the key app screens
- feed ads rendering for in-feed, sidebar, and interstitial placements
- admin area for moderation, campaigns, exchange rates, logs, and system controls
- dwell-time collection and feed ranking
- moderation rules with signaled scoring and locale-aware heuristics
- Super Admin access and override flow
- prompt-compliance interaction and interest tables for dwell-based ranking

## What Is Left

| Area | Status | Notes |
| --- | --- | --- |
| Locale detection and file loading | Done | Locale context and locale JSON files are wired into the app. |
| GeoIP locale hinting | Mostly done | Backend can query an optional GeoIP provider, then falls back to browser locale or English. |
| RTL behavior | Mostly done | Key screens are RTL-aware; minor polish may still be possible in edge cases. |
| Moderation model | Mostly done | Signaled heuristic model is in place; not a full ML/AI moderation stack. |
| Moderation provider schema | Done | Provider responses can return a combined `result` object with locale and moderation signals. |
| IP blacklist and nuke flow | Done | Moderation offenses can blacklist IPs and the admin nuke path can add them too. |
| Super Admin override | Done | Admin guard and role override paths are implemented. |
| Dwell-time ranking | Done | `dwell_events`, `UserInteractions`, and `UserInterests` are combined to rank posts. |
| UserInteractions / UserInterests | Done | These tables store the raw interaction stream and weighted interests for feed ranking. |
| Ads rendering | Done | In-feed, sidebar, and interstitial ad placements are rendered. |
| Multi-currency ad revenue | Done | Exchange rates and revenue snapshot endpoints are implemented. |

## How To Verify

Frontend:

```bash
cd frontend
npm test -- --runInBand
```

Backend:

```bash
pytest -q backend_test.py test_moderation_rules.py test_moderation_provider.py backend/test_feed_ranking.py backend/test_geoip_locale.py
```

Docker:

```bash
docker compose up --build
```

- Frontend web: `http://localhost:3000`
- Backend API: `http://localhost:8000/api`

## Notes

- The backend can run with either MongoDB or SQLite, depending on environment variables.
- PostgreSQL-ready mode is now available behind `DATABASE_URL` with the new storage and repository layers, while SQLite remains the default stable path.
- The frontend includes Jest setup for offline test execution.
- Live integrations can be enabled through environment variables:
  - `EXCHANGE_RATES_API_URL`
  - `MODERATION_PROVIDER_URL`
  - `MODERATION_PROVIDER_API_KEY`
  - `MODERATION_PROVIDER_MODEL`
  - `MODERATION_PROVIDER_KIND`
- See [`DEPLOYMENT.md`](/workspaces/desktop-tutorial/DEPLOYMENT.md) and [`POSTGRES_MIGRATION.md`](/workspaces/desktop-tutorial/POSTGRES_MIGRATION.md) for the production and migration path.
