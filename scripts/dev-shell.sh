#!/usr/bin/env bash
set -euo pipefail

docker compose up -d postgres minio nats dev
exec docker compose exec dev bash
