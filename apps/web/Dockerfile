# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.2.18

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/whatsapp/package.json services/whatsapp/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY apps/web apps/web
COPY packages/shared packages/shared
ARG VITE_API_URL=/api
ARG VITE_CENTRIFUGO_URL
ARG VITE_VAPID_PUBLIC_KEY=
ARG VITE_BILLING_URL=
ARG VITE_BILLING_REQUIRED_AFTER_SETUP=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_CENTRIFUGO_URL=${VITE_CENTRIFUGO_URL} \
    VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY} \
    VITE_BILLING_URL=${VITE_BILLING_URL} \
    VITE_BILLING_REQUIRED_AFTER_SETUP=${VITE_BILLING_REQUIRED_AFTER_SETUP}
RUN test -n "$VITE_CENTRIFUGO_URL" \
 && { test "$VITE_BILLING_REQUIRED_AFTER_SETUP" != "true" || test -n "$VITE_BILLING_URL"; } \
 && bun run --filter @wateaminbox/shared build \
 && bun run --filter @wateaminbox/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN printf '%s\n' \
  'server {' \
  '  listen 8080;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location = /healthz { access_log off; add_header Content-Type text/plain; return 200 "ok\\n"; }' \
  '  location /assets/ { try_files $uri =404; expires 1y; add_header Cache-Control "public, immutable"; }' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
