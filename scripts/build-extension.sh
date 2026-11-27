#!/usr/bin/env bash
# Build-Wrapper. Die ADR-007-Umgebungs-Injection ist seit ADR-012 entfernt:
# Credentials kommen zur Laufzeit aus der Options-Pflege oder dem
# Host-Deploy (chrome.storage.managed) — das Bundle ist immer secret-frei.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run "build:${BUILD_TARGET:-chrome}"
