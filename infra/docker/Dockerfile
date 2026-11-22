# One image for the API, the worker, the migrations and the CLI (plan, section 5).
# Base pinned by digest (Renovate updates it). NODE_IMAGE can point to a registry mirror.
ARG NODE_IMAGE=node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

FROM ${NODE_IMAGE} AS base
ENV CI=true
RUN npm install --global pnpm@10.34.9 --no-fund --no-audit
WORKDIR /app

# Every locked package, downloaded once: this layer only changes with the lockfile.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile \
 && pnpm --filter @job4me/web build \
 && pnpm --filter @job4me/api build \
 && pnpm --filter @job4me/worker build

# Production dependencies of the API and of the worker only, at the lockfile versions.
# The bundles inline our own packages: hoisting makes their dependencies reachable from /app.
FROM fetch AS deps
COPY . .
RUN rm -rf node_modules \
 && pnpm install --offline --frozen-lockfile --prod --ignore-scripts \
      --config.shamefully-hoist=true --filter '@job4me/api...' --filter '@job4me/worker...' \
 && rm -rf node_modules/@job4me

FROM ${NODE_IMAGE} AS runtime
# npm, npx and corepack are not needed to run the bundles: fewer packages to keep patched.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    JOB4ME_ENV=production \
    JOB4ME_CONFIG_DIR=/app/config \
    JOB4ME_WEB_DIST=/app/web \
    JOB4ME_MIGRATIONS_DIR=/app/migrations
# Mount point of the `files` volume, owned by the image user so a new volume inherits it.
RUN mkdir -p /var/lib/job4me/files && chown node:node /var/lib/job4me/files
WORKDIR /app
COPY infra/docker/package.json ./package.json
COPY config/default.yaml ./config/default.yaml
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/db/drizzle ./migrations
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/apps/worker/dist ./worker
COPY --from=build /app/apps/api/dist ./api
USER node
EXPOSE 3000
CMD ["node", "api/index.js"]
