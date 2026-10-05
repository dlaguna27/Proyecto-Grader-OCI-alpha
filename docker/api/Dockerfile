# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @noi/shared --workspace @noi/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @noi/shared && npm run build -w @noi/api \
 && npm prune --omit=dev --workspace @noi/shared --workspace @noi/api --include-workspace-root

FROM node:24-trixie-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 CMD curl -fsS http://localhost:3000/api/health || exit 1
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
