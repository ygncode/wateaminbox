#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output=$(docker run --rm \
  --tmpfs /run/wateaminbox-control:rw,noexec,nosuid,nodev,mode=0700,uid=0,gid=0 \
  -e EPHEMERAL_HTTP_BEARER_TOKEN_FILE=/run/wateaminbox-control/http-bearer-token \
  -v "$ROOT/infrastructure/docker/secret-entrypoint.sh:/entrypoint:ro" \
  alpine:3.22 /bin/sh /entrypoint sh -ec '
    [ -z "${HTTP_BEARER_TOKEN-}" ]
    [ "$HTTP_BEARER_TOKEN_FILE" = /run/wateaminbox-control/http-bearer-token ]
    [ "$(stat -c %a "$HTTP_BEARER_TOKEN_FILE")" = 600 ]
    [ "$(stat -c %u "$HTTP_BEARER_TOKEN_FILE")" = 0 ]
    [ "$(wc -c <"$HTTP_BEARER_TOKEN_FILE" | tr -d " ")" = 65 ]
    printf ok
  ')
[ "$output" = ok ]
rg -q 'EPHEMERAL_HTTP_BEARER_TOKEN_FILE: /run/wateaminbox-control/http-bearer-token' "$ROOT/compose.production.yml"
echo 'ok - fresh file-only control authority uses the exact root tmpfs path'
