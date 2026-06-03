# Deployment Guide

This project can run in a simple production setup with:

- FastAPI backend
- Expo web frontend
- SQLite for the current backend persistence path
- optional MongoDB for the existing Mongo-backed code paths
- PostgreSQL-ready storage mode behind `DATABASE_URL`

## Environment Variables

Backend:

- `DATABASE_PATH`
  - SQLite path for local/dev and container fallback
- `DATABASE_URL`
  - enables the PostgreSQL-ready storage mode when paired with the repository layer and psycopg driver
- `SECRET_KEY`
  - required in production
- `SUPER_ADMIN_EMAIL`
  - grants the first admin identity
- `EXCHANGE_RATES_API_URL`
  - live exchange-rate source
- `EXCHANGE_RATES_REFRESH_SECONDS`
  - refresh interval for exchange rates
- `MODERATION_PROVIDER_URL`
  - live moderation provider endpoint
- `MODERATION_PROVIDER_API_KEY`
  - optional bearer token for moderation provider
- `MODERATION_PROVIDER_MODEL`
  - provider model/name hint
- `MODERATION_PROVIDER_KIND`
  - `http` for a generic provider endpoint or `openai` for an OpenAI-compatible moderation provider
- `GEOIP_LOCALE_PROVIDER_URL`
  - optional GeoIP locale detection endpoint
- `UserInteractions` / `UserInterests`
  - prompt-compliance interaction and interest tables created by the SQLite path
  - `UserInteractions` stores the raw interaction stream and `UserInterests` stores the weighted interest profile
- moderation provider responses may return a combined `result` object with:
  - `score`
  - `action`
  - `queue`
  - `reason`
  - `locale`
  - `language`
  - `signals`
- moderation provider contract:
  - request payload includes `input`, `locale`, `client_ip`, `task`, and `output_schema`
  - response may return either top-level fields or a nested `result` object
  - the backend merges the provider result with the heuristic fallback when needed
  - when `MODERATION_PROVIDER_KIND=openai`, `MODERATION_PROVIDER_URL` is used as the OpenAI-compatible base URL and the backend sends a JSON-only prompt through `AsyncOpenAI`
- `MONGO_URL`
  - optional if you want Mongo-backed persistence paths

Frontend:

- `EXPO_PUBLIC_API_BASE_URL`
  - backend API base URL, for example `https://api.example.com/api`

## Suggested Production Flow

1. Deploy the backend as a web service.
2. Choose a storage path:
   - keep SQLite volume-backed for the current stable path
   - use MongoDB for the existing Mongo-backed paths
   - move to PostgreSQL-ready mode by setting `DATABASE_URL` and keeping the PostgreSQL repository adapter installed
3. Set the backend secrets and provider URLs.
4. Deploy the Expo frontend as web or as a mobile build target.
5. Point the frontend to the backend using `EXPO_PUBLIC_API_BASE_URL`.

## Docker Quick Start

```bash
docker compose up --build
```

- Frontend web: `http://localhost:3000`
- Backend API: `http://localhost:8000/api`

The backend container keeps the current SQLite flow by default. PostgreSQL-ready
mode is available behind `DATABASE_URL` once the psycopg driver and repository
adapter are installed.

For feed ranking, the backend combines:

- `dwell_events`
- `UserInteractions`
- `UserInterests`
- follow / like / comment social signals
- a controlled explore bucket

When `MODERATION_PROVIDER_KIND=openai` is enabled, the backend sends a JSON-only
schema prompt through `AsyncOpenAI` and still falls back to heuristics if the
provider fails.

## Platform Notes

### AWS

- Run the backend on ECS, App Runner, or Elastic Beanstalk.
- Put the frontend web export behind S3 + CloudFront or use a small web host.
- Use RDS PostgreSQL only after the backend storage refactor is complete.
- If you are ready to test the PostgreSQL path, use `DATABASE_URL` together with
  the new repository adapter and keep the SQLite flow as the fallback during the
  rollout.
- Set secrets in the platform secret manager, not in images.

### DigitalOcean

- Use App Platform for the backend container and frontend web container.
- Use a managed database or a volume-backed SQLite path for the current codebase.
- Point `EXPO_PUBLIC_API_BASE_URL` to the backend service URL.

### Heroku

- Deploy backend as a web dyno.
- Use Heroku Postgres only after the backend storage layer is migrated.
- PostgreSQL-ready mode can also be exercised through `DATABASE_URL` before a
  full migration if you want a staged rollout.
- Deploy the frontend as a separate web app or static site host.
- Set `SECRET_KEY`, live provider env vars, and `SUPER_ADMIN_EMAIL` in config vars.

## Local Smoke Check

```bash
cd frontend
npm test -- --runInBand
npm run lint
cd ..
pytest -q backend_test.py test_moderation_rules.py test_moderation_provider.py backend/test_feed_ranking.py backend/test_geoip_locale.py
```
