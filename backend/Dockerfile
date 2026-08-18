# API image. Build from repository root (build context = repo root):
#   docker build -f backend/Dockerfile -t attirebygv-api:local .
#
# On Railway: Root Directory = "/" and Dockerfile Path = "backend/Dockerfile".
# Set DATABASE_URL, DIRECT_URL, JWT secrets, and CORS_ORIGINS in Railway variables
# (prod Supabase project — never use the same URLs as local backend/.env dev DB).
#
# Run locally (needs env at runtime):
#   docker run --env-file backend/.env -p 4100:4100 gvnutrition-api:local
#
# Dev → prod schema flow:
#   1. Local: backend/.env = dev DB → change schema.prisma → npm run db:migrate → test
#   2. Git push (commits prisma/migrations/* + code)
#   3. Railway rebuilds this image; on start, docker-entrypoint.sh runs
#      `prisma migrate deploy` against Railway's prod DB, then starts the API.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# Run install scripts so bcrypt's native binding and Prisma engine binaries are fetched.
RUN npm ci
COPY backend/prisma ./backend/prisma
WORKDIR /app/backend
RUN npx prisma generate
WORKDIR /app
COPY backend ./backend
RUN npm run build -w @rms/api

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/backend/package.json ./backend/package.json
COPY --from=deps /app/frontend/package.json ./frontend/package.json
COPY --from=deps /app/backend/assets ./backend/assets
COPY --from=deps /app/backend/dist ./backend/dist
COPY --from=deps /app/backend/prisma ./backend/prisma
WORKDIR /app/backend
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 4100
ENTRYPOINT ["./docker-entrypoint.sh"]
