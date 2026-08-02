# syntax=docker/dockerfile:1.7
ARG GO_VERSION=1.25.0

FROM golang:${GO_VERSION}-alpine AS whatsapp-build
WORKDIR /src
COPY services/shared/go.mod services/shared/go.sum shared/
COPY services/whatsapp/go.mod services/whatsapp/go.sum whatsapp/
WORKDIR /src/whatsapp
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY services/shared /src/shared
COPY services/whatsapp /src/whatsapp
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/whatsapp-worker ./main.go

FROM golang:${GO_VERSION}-alpine AS orchestrator-build
WORKDIR /src
COPY services/shared/go.mod services/shared/go.sum shared/
COPY services/orchestrator/go.mod services/orchestrator/go.sum orchestrator/
WORKDIR /src/orchestrator
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY services/shared /src/shared
COPY services/orchestrator /src/orchestrator
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/orchestrator ./main.go

FROM alpine:3.22 AS orchestrator
RUN apk add --no-cache ca-certificates tzdata procps \
 && addgroup -S -g 10001 whatsapp \
 && adduser -S -D -H -u 10001 -G whatsapp whatsapp
COPY --from=orchestrator-build /out/orchestrator /usr/local/bin/orchestrator
COPY --from=whatsapp-build /out/whatsapp-worker /usr/local/bin/whatsapp-worker
COPY infrastructure/docker/secret-entrypoint.sh /usr/local/bin/secret-entrypoint
RUN chmod 0555 /usr/local/bin/orchestrator /usr/local/bin/whatsapp-worker /usr/local/bin/secret-entrypoint
USER whatsapp
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/secret-entrypoint"]
CMD ["/usr/local/bin/orchestrator"]
