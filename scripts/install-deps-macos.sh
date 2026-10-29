#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" != '--install' ]; then
  echo 'Optional host tools: brew install uv node@24; brew install --cask docker'
  echo 'This script installs nothing unless invoked with --install.'
  exit 0
fi
command -v brew >/dev/null || { echo 'Install Homebrew from https://brew.sh first.'; exit 1; }
brew install uv node@24
brew install --cask docker
