# syntax=docker/dockerfile:1.7
#
# Single multi-target Dockerfile for all 3 microservices. Each service has its
# own runtime stage; pick which one with `--target bff|metrics|logs` (or via
# `target:` in docker-compose).

# ---------- shared build stage ----------
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bff     ./services/bff && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/metrics ./services/metrics && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/logs    ./services/logs

# ---------- runtime: bff ----------
FROM alpine:3.20 AS bff
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
WORKDIR /app
COPY --from=build /out/bff /app/bff
EXPOSE 8080
ENTRYPOINT ["/app/bff"]

# ---------- runtime: metrics ----------
FROM alpine:3.20 AS metrics
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
WORKDIR /app
COPY --from=build /out/metrics /app/metrics
EXPOSE 50051
ENTRYPOINT ["/app/metrics"]

# ---------- runtime: logs ----------
FROM alpine:3.20 AS logs
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
WORKDIR /app
COPY --from=build /out/logs /app/logs
EXPOSE 50052
ENTRYPOINT ["/app/logs"]
