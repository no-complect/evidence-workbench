#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need_docker
docker compose exec -T api python scripts/demo.py
