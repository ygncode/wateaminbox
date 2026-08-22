# syntax=docker/dockerfile:1.7
FROM golang:1.25.0-alpine AS wrapper-build
WORKDIR /src
COPY infrastructure/centrifugo/entrypoint/go.mod ./
COPY infrastructure/centrifugo/entrypoint/main.go ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/centrifugo-secret-entrypoint .

FROM centrifugo/centrifugo:v6.9.1
COPY --from=wrapper-build --chown=centrifugo:centrifugo /out/centrifugo-secret-entrypoint /usr/local/bin/centrifugo-secret-entrypoint
ENTRYPOINT ["/usr/local/bin/centrifugo-secret-entrypoint"]
CMD ["centrifugo"]
