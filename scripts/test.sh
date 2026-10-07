#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
command -v uv >/dev/null || { echo 'uv is required for host tests; see README.'; exit 1; }
uv run --frozen pytest -m 'not integration'
uv run --frozen python scripts/check-contracts.py
npm --prefix apps/web run test:proxy
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
