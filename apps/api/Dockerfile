# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.2.18

FROM oven/bun:${BUN_VERSION}-alpine AS workspace
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/whatsapp/package.json services/whatsapp/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM workspace AS build
COPY apps/api apps/api
COPY packages/database packages/database
COPY packages/shared packages/shared
RUN bun run --filter @wateaminbox/shared build \
 && bun run --filter @wateaminbox/database build \
 && bun run --filter @wateaminbox/api build

FROM workspace AS production-dependencies
RUN --mount=type=cache,target=/root/.bun/install/cache \
    rm -rf node_modules \
 && bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION}-alpine AS api
WORKDIR /app
ENV NODE_ENV=production PORT=4445
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=bun:bun /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=bun:bun /app/packages/shared/dist ./packages/shared/dist
COPY --chown=bun:bun package.json ./package.json
COPY --chown=bun:bun apps/api/package.json apps/api/package.json
COPY --chown=bun:bun packages/database/package.json packages/database/package.json
COPY --chown=bun:bun packages/shared/package.json packages/shared/package.json
COPY infrastructure/docker/secret-entrypoint.sh /usr/local/bin/secret-entrypoint
RUN chmod 0555 /usr/local/bin/secret-entrypoint
USER bun
EXPOSE 4445
ENTRYPOINT ["/usr/local/bin/secret-entrypoint"]
CMD ["bun", "run", "apps/api/dist/index.js"]

FROM production-dependencies AS migration
WORKDIR /app
ENV NODE_ENV=production
# Production deploys use a restrictive umask, so Git may materialize changed
# manifests as 0600. Bun resolves the workspace manifest before running the
# migration entry point; make its runtime ownership and mode independent of the
# checkout rather than weakening the host's deployment permissions.
COPY --chown=bun:bun --chmod=0444 package.json ./package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/database packages/database
COPY infrastructure/docker/secret-entrypoint.sh /usr/local/bin/secret-entrypoint
RUN chmod 0555 /usr/local/bin/secret-entrypoint \
 && chown -R bun:bun /app/packages/database /app/packages/shared
USER bun
ENTRYPOINT ["/usr/local/bin/secret-entrypoint"]
CMD ["bun", "run", "packages/database/migrate.ts"]
