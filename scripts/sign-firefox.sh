#!/usr/bin/env bash
# Signiert die Firefox-Extension per AMO (unlisted self-distribution) —
# nötig, weil Firefox-Release KEINE unsignden XPIs per Enterprise-Policy
# installiert (empirisch: ERROR_SIGNEDSTATE_REQUIRED, Nov 2026).
#
#   Env-Quelle:  /run/agenix/amo-sign-env  (export AMO_API_KEY=… / AMO_API_SECRET=…)
#   Ziel:        ../nixos-configuration/packages/kdbx-keychain.xpi  (signiert)
#
# Nach erfolgreichem Signieren: im nixos-Repo `git add -N` + Rebuild — die
# home-manager-Policy (hosts/jannis/home.nix) aktiviert sich automatisch,
# sobald die XPI im Repo liegt.
#
# Hinweis: AMO lehnt RE-Signierung derselben Version teils ab → dann Version
# in manifest.firefox.json hochziehen und erneut ausführen.
set -euo pipefail
cd "$(dirname "$0")/.."

NIXOS_REPO="${NIXOS_REPO:-$HOME/workspace/nixos-configuration}"
GECKO_ID="kdbx-keychain@nix-dev.link"
OUT="$NIXOS_REPO/packages/kdbx-keychain.xpi"

if [[ ! -r /run/agenix/amo-sign-env ]]; then
  echo "✗ /run/agenix/amo-sign-env fehlt — erst agenix-Secret befüllen (AMO_API_KEY/AMO_API_SECRET)." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /run/agenix/amo-sign-env

command -v web-ext >/dev/null || {
  # devDep im Workspace?
  if [[ -x node_modules/.bin/web-ext ]]; then
    PATH="$PWD/node_modules/.bin:$PATH"
  else
    echo "web-ext fehlt — npm i -D web-ext (Workspace) oder nix-shell -p nodejs." >&2
    exit 1
  fi
}

# 1) Bauen (mit Build-Injection aus der Dropbox-Keychain-Env)
BUILD_TARGET=firefox scripts/build-extension.sh

# 2) Signieren (unlisted = self-distribution, NICHT in AMO gelistet)
ART="$(mktemp -d)"
trap 'rm -rf "$ART"' EXIT
web-ext sign \
  --source-dir packages/extension/dist/firefox \
  --artifacts-dir "$ART" \
  --channel unlisted \
  --api-key "${AMO_API_KEY:?AMO_API_KEY fehlt}" \
  --api-secret "${AMO_API_SECRET:?AMO_API_SECRET fehlt}" \
  --verbose

SIGNED="$(find "$ART" -name '*.xpi' -o -name '*.zip' | head -1)"
[[ -n "$SIGNED" ]] || { echo "✗ Keine signierte XPI im Artifacts-Dir." >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
cp "$SIGNED" "$OUT"
echo "✓ Signiert: $OUT"
echo "  → cd $NIXOS_REPO && git add -N packages/kdbx-keychain.xpi && nixos-rebuild switch"
