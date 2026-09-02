# syntax=docker/dockerfile:1.7
ARG GO_VERSION=1.25.0

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY services/shared/go.mod services/shared/go.sum shared/
COPY services/whatsapp/go.mod services/whatsapp/go.sum whatsapp/
COPY vendor/whatsmeow /vendor/whatsmeow
WORKDIR /src/whatsapp
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY services/shared /src/shared
COPY services/whatsapp /src/whatsapp
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/whatsapp-worker ./main.go

FROM alpine:3.22 AS artifact-installer
RUN apk add --no-cache ca-certificates
COPY --from=build /out/whatsapp-worker /opt/wateaminbox/worker/whatsapp-worker
COPY infrastructure/docker/install-worker-artifact.sh /usr/local/bin/install-worker-artifact
RUN chmod 0555 /opt/wateaminbox/worker/whatsapp-worker /usr/local/bin/install-worker-artifact \
 && sha256sum /opt/wateaminbox/worker/whatsapp-worker | awk '{print $1}' \
    > /opt/wateaminbox/worker/whatsapp-worker.sha256 \
 && chmod 0444 /opt/wateaminbox/worker/whatsapp-worker.sha256
ENTRYPOINT ["/usr/local/bin/install-worker-artifact"]

FROM alpine:3.22 AS worker
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 whatsapp \
 && adduser -S -D -H -u 10001 -G whatsapp whatsapp
COPY --from=build /out/whatsapp-worker /usr/local/bin/whatsapp-worker
USER whatsapp
ENTRYPOINT ["/usr/local/bin/whatsapp-worker"]
