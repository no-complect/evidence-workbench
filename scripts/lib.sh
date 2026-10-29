#!/usr/bin/env bash
set -euo pipefail
WORKBENCH_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKBENCH_ROOT"
need_docker() {
  command -v docker >/dev/null || { echo 'Docker is missing. Install Docker Desktop (or Docker Engine + Compose), then retry. No dependencies were installed.' >&2; exit 1; }
  docker compose version >/dev/null || { echo 'Docker Compose v2+ is required.' >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo 'Docker is not accessible. Start Docker Desktop and ensure this shell can access its socket, then retry.' >&2; exit 1; }
}
