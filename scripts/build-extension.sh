#!/usr/bin/env bash
# Build mit Injektion der Dropbox-Keys aus der agenix-Env (ADR-007).
#   Env-Quelle: /run/agenix/dropbox-keychain-env (export-Zeilen)
#   Ziel:       npm run build:chrome  (bzw. BUILD_TARGET=firefox)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -r /run/agenix/dropbox-keychain-env ]]; then
  # shellcheck disable=SC1091
  source /run/agenix/dropbox-keychain-env
fi

export DROPBOX_APP_KEY="${DROPBOX_APP_KEY:-}"
if [[ -z "$DROPBOX_APP_KEY" ]]; then
  echo "⚠  DROPBOX_APP_KEY leer — baue mit Placeholder (ADR-007)." >&2
fi

npm run "build:${BUILD_TARGET:-chrome}"
