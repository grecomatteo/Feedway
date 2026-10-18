# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@12.11.2
WORKDIR /repo

# 1) download every dependency from the lockfile only: cached until the lockfile changes
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# 2) offline install, build, and production-only copy of the worker
FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --ignore-scripts
RUN pnpm exec turbo run build --filter=@app/web --filter=@app/worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @app/worker --config.node-linker=hoisted deploy --prod --legacy /out/worker

# 3) runtime
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} HOST=0.0.0.0 PORT=3000
RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --no-install-recommends --yes ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /out/worker/node_modules ./apps/worker/node_modules
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /repo/apps/web/.output ./apps/web/.output
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["web"]
