# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.2.18

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/marketing/package.json apps/marketing/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/waitlist-api/package.json apps/waitlist-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/whatsapp/package.json services/whatsapp/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY apps/marketing apps/marketing
ARG PUBLIC_WAITLIST_API_URL=
ARG PUBLIC_WAITLIST_TURNSTILE_SITE_KEY=
ENV PUBLIC_WAITLIST_API_URL=${PUBLIC_WAITLIST_API_URL} \
    PUBLIC_WAITLIST_TURNSTILE_SITE_KEY=${PUBLIC_WAITLIST_TURNSTILE_SITE_KEY}
RUN bun run --filter @wateaminbox/marketing build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS marketing
COPY --from=build /app/apps/marketing/dist /usr/share/nginx/html
RUN printf '%s\n' \
  'server {' \
  '  listen 8080;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location = /healthz { access_log off; add_header Content-Type text/plain; return 200 "ok\\n"; }' \
  '  location /assets/ { try_files $uri =404; expires 1y; add_header Cache-Control "public, immutable"; }' \
  '  location / { try_files $uri $uri/ $uri.html =404; }' \
  '}' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
