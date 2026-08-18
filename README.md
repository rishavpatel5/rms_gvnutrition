# Monorepo — Retail Management System (foundation)

## Scripts

| Script | Description |
|--------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | API (`:4100`) + Vite (`:5273`) via `concurrently` |
| `npm run build` | Typecheck/build API then web |
| `npm run db:generate` | `prisma generate` in `backend` |
| `npm run db:migrate` | `prisma migrate dev` in `backend` |
| `npm run docker:up` | Start optional local Postgres (`gvnutrition-postgres`, host port **55432**) |
| `npm run docker:down` | Stop compose services (named volume `gvnutrition_postgres_data` is kept) |
| `npm run docker:logs` | Follow Postgres container logs |

## Local Postgres (Docker)

> **Not needed for GV Nutrition** — this project uses a Supabase dev database. These steps are
> only for running Postgres locally instead.

1. From repository root: `npm run docker:up` (builds `docker/postgres/Dockerfile`, starts **`gvnutrition-postgres`**).
2. Set `backend/.env` → `DATABASE_URL` to match compose (user `rms`, password `rms_local_dev`, database `rms_dev`, host port `55432`).
3. Host port **55432** is deliberate — it keeps this container clear of Attire's local Postgres on 5432.

**API Docker image (optional):** from repo root, `docker build -f backend/Dockerfile -t gvnutrition-api:local .`

## First run

1. `npm run docker:up` (or use your own Postgres) and set `backend/.env` from `backend/.env.example` (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`).
2. `npm install` from repository root.
3. `npm run db:migrate -w @rms/api` — apply Prisma migrations (includes auth `refresh_tokens` after Phase 3).
4. **First admin (dev):** set `AUTH_BOOTSTRAP_ENABLED=true` once, `POST /api/v1/auth/bootstrap`, then set it back to `false` and create further users via `POST /api/v1/auth/users` as admin.
5. `npm run dev` — web app proxies `/api` to the API.

## Docs

- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — API shape, naming, layering.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — folder structure and dependency overview.
- [`docs/AUTH.md`](docs/AUTH.md) — JWT, refresh rotation, RBAC, endpoints.
- [`docs/CATALOG_AND_INVENTORY.md`](docs/CATALOG_AND_INVENTORY.md) — Products, variants, inventory engine APIs.

## Hostinger (outline)

- **API:** Node process running `node backend/dist/index.js` with `NODE_ENV=production`, env vars set in hPanel, `npm run db:migrate:deploy` (or CI) before start.
- **Web:** `npm run build -w @rms/web` → static files from `frontend/dist`; serve via static hosting or the same reverse proxy as the API.
- **Database:** managed PostgreSQL (Supabase or Hostinger PostgreSQL); only `DATABASE_URL` changes.
