#!/usr/bin/env bash
# Dev-Loop für Firefox Dev Edition (Deklarativ-Policy):
#   baut die Firefox-Extension und legt sie unter STABILEM Namen ab.
# Die home-manager-Policy (nixos-configuration, hosts/jannis/home.nix) zeigt
# auf genau diese Datei; Firefox Dev Edition reinstalliert automatisch,
# sobald sich der Inhalt ändert → danach nur den Dev-Browser neu starten.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_TARGET=firefox scripts/build-extension.sh

if pgrep -f "firefox-devedition" > /dev/null; then
  echo ""
  echo "⚠️  firefox-devedition LÄUFT NOCH — XPI wurde ersetzt, aber der Browser"
  echo "    lädt sie erst nach einem VOLLSTÄNDIGEN Neustart (alle Fenster zu)."
  echo "    Sonst: vermischtener Zustand / leeres Popup ('Extension context invalidated')."
  echo ""
fi
OUT=packages/extension/dist/firefox/kdbx-keychain-dev.xpi
rm -f "$OUT"
# managed-schema.json gehört ins XPI: das Manifest referenziert es (ADR-012).
(cd packages/extension/dist/firefox && zip -q -r -X "$(basename "$OUT")" manifest.json background.js content.js managed-schema.json popup options)

echo "✓ $OUT ($(wc -c < "$OUT") Bytes) — Firefox Dev Edition neu starten."

# Installierte Kopie im Dev-Profil DIREKT ersetzen: der Policy-Reinstall bei
# Dateiänderung greift nicht zuverlässig bei jedem Start — so übernimmt der
# nächste Browser-Start garantiert den neuen Build (Signatur egal in Dev).
PROFXPI="$HOME/.config/kdbx-dev-firefox/profile/extensions/kdbx-keychain@nix-dev.link.xpi"
if [[ -d "$(dirname "$PROFXPI")" ]]; then
  cp "$OUT" "$PROFXPI" && echo "✓ Dev-Profil-XPI ersetzt: $PROFXPI"
fi
