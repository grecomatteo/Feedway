# syntax=docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@12.15.0
WORKDIR /repo

# 1) download every dependency from the lockfile only: cached until the lockfile changes
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# 2) offline install, build, and production-only copy of the worker
FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --ignore-scripts
RUN pnpm exec turbo run build --filter=@app/web --filter=@app/worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @app/worker --config.node-linker=hoisted deploy --prod --legacy /out/worker

# 3) ffmpeg of the image: the CI runs the media integration tests with this same stage
#    (scripts/ci/media-tools.sh), so they test the version the worker uses (plan 04 Task 10)
FROM ${NODE_IMAGE} AS media-tools
RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --no-install-recommends --yes ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 4) runtime
FROM media-tools AS runtime
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} HOST=0.0.0.0 PORT=3000
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /media \
    && chown 10001:10001 /media
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
