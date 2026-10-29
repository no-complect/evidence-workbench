#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need_docker
docker compose exec -T eval-worker python -m workbench.evaluate "$@"
mkdir -p evals/results
docker compose cp eval-worker:/app/evals/results/. evals/results/
