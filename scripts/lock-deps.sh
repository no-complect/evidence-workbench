#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
command -v uv >/dev/null || { echo 'Install uv first; no dependencies changed.'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node 24 first; no dependencies changed.'; exit 1; }
uv lock
npm --prefix apps/web install --package-lock-only --ignore-scripts --no-audit --no-fund
printf 'Review and commit uv.lock and apps/web/package-lock.json before a release.\n'
