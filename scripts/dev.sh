#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need_docker
case "${1:-}" in --check) echo 'Docker and Compose available.'; exit 0;; ''|--no-follow) ;; *) echo 'Usage: ./scripts/dev.sh [--check|--no-follow]'; exit 2;; esac
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; fi
mkdir -p evals/results
# Installs project dependencies inside containers only; never installs host tools.
docker compose up --build -d --wait --wait-timeout 240
printf '\nEvidence workbench: http://localhost:3000\nAPI health: http://localhost:8000/health\nAPI schema: http://localhost:8000/docs\nStop: ./scripts/stop.sh (keeps your data)\n\n'
if [ "${1:-}" != '--no-follow' ]; then docker compose logs --follow api worker web; fi
