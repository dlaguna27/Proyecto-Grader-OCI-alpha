# syntax=docker/dockerfile:1
# Static frontend + reverse proxy (Caddy). Serves the SPA and proxies /api to the API.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @noi/shared --workspace @noi/web --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @noi/shared && npm run build -w @noi/web

FROM caddy:2.10-alpine
COPY --from=build /app/apps/web/dist /srv
COPY docker/web/Caddyfile /etc/caddy/Caddyfile
