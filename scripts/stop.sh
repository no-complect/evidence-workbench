#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need_docker
if [ "${1:-}" = '--reset' ]; then
  if [ "${2:-}" != '--yes-delete-local-data' ]; then
    echo 'Reset deletes this compose project’s local database and uploaded objects.' >&2
    echo 'To confirm: ./scripts/stop.sh --reset --yes-delete-local-data' >&2
    exit 2
  fi
  docker compose down --volumes
elif [ -z "${1:-}" ]; then
  docker compose down
else
  echo 'Usage: ./scripts/stop.sh [--reset --yes-delete-local-data]' >&2
  exit 2
fi
