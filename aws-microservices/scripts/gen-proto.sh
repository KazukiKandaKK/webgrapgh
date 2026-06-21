#!/usr/bin/env bash
# Regenerate Go gRPC code from every .proto in this repo.
# Uses a one-off golang:1.25-alpine container so no host toolchain is needed.
set -euo pipefail

cd "$(dirname "$0")/.."

docker run --rm \
  -v "$PWD:/src" \
  -w /src \
  -e GOFLAGS="-mod=mod" \
  golang:1.25-alpine sh -c '
    apk add --no-cache protoc protobuf-dev >/dev/null
    go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
    export PATH=$PATH:/root/go/bin

    protoc \
      --go_out=. --go_opt=paths=source_relative \
      --go-grpc_out=. --go-grpc_opt=paths=source_relative \
      proto/metrics/metrics.proto \
      proto/logs/logs.proto

    echo "generated:"
    find proto -name "*.pb.go"
  '
