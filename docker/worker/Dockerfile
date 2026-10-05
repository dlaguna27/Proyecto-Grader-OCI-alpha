# syntax=docker/dockerfile:1
# Grading worker: isolate sandbox + g++ + Python 3 + Node.js orchestrator.
FROM node:24-trixie-slim AS isolate-build
ARG ISOLATE_VERSION=v2.7
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcap-dev libseccomp-dev git ca-certificates pkg-config \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${ISOLATE_VERSION} https://github.com/ioi/isolate /src/isolate \
 && cd /src/isolate && make isolate CONFIG=/usr/local/etc/isolate
ARG TESTLIB_VERSION=0.9.41
ADD https://raw.githubusercontent.com/MikeMirzayanov/testlib/${TESTLIB_VERSION}/testlib.h /opt/testlib/testlib.h

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @noi/shared --workspace @noi/worker --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npm run build -w @noi/shared && npm run build -w @noi/worker \
 && npm prune --omit=dev --workspace @noi/shared --workspace @noi/worker --include-workspace-root --ignore-scripts

FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ libc6-dev python3 libcap2 libseccomp2 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=isolate-build /src/isolate/isolate /usr/local/bin/isolate
COPY --from=isolate-build /opt/testlib/testlib.h /opt/testlib/testlib.h
RUN chmod 4755 /usr/local/bin/isolate && chmod 644 /opt/testlib/testlib.h
COPY docker/worker/isolate.cf /usr/local/etc/isolate
COPY docker/worker/cgroup-init.sh /usr/local/bin/cgroup-init
RUN chmod +x /usr/local/bin/cgroup-init && mkdir -p /var/cache/judge
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/worker/package.json apps/worker/
COPY --from=build /app/apps/worker/dist apps/worker/dist
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/cgroup-init"]
CMD ["node", "apps/worker/dist/index.js"]
