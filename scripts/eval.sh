#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need_docker
docker compose exec -T worker python -m workbench.evaluate "$@"
mkdir -p evals/results
docker compose cp worker:/app/evals/results/. evals/results/
