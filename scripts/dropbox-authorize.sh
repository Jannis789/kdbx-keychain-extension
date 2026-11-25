#!/usr/bin/env bash
# Interaktiver Dropbox-OAuth für rclone (einmalig nötig, Phase 0/2).
#
# Öffnet einen Browser-Dialog: Dropbox-Login mit deinem Account, Zugriff erlauben.
# Die Ausgabe (OAuth-Token) muss in ~/.config/rclone/rclone.conf eingetragen werden
# — Phase 2 automatisiert das inkl. systemd-user-Service.
#
# Voraussetzungen: agenix-Secret dropbox-keychain-env (DROPBOX_APP_KEY/SECRET) + Browser.
set -euo pipefail

NIXCFG="${NIXCFG:-$HOME/workspace/nixos-configuration}"

set -a
# shellcheck disable=SC2046
eval "$(agenix -d "$NIXCFG/secrets/dropbox-keychain-env.age")"
set +a

nix run nixpkgs#rclone -- --config "$HOME/.config/rclone/rclone.conf" authorize \
  "dropbox" "$DROPBOX_APP_KEY" "$DROPBOX_APP_SECRET"

echo
echo "→ Autorisierungs-Zeilen oben ausgeben lassen und in ~/.config/rclone/rclone.conf eintragen:"
echo "    mkdir -p ~/.config/rclone && chmod 700 ~/.config/rclone"
echo "    [dropbox]  + type/client_id/client_secret/token-Blöcke"
echo "    chmod 600 ~/.config/rclone/rclone.conf"
