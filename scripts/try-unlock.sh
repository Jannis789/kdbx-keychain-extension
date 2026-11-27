#!/usr/bin/env bash
# Interaktiver Unlock-Test für einen kdbx-Tresor.
#
#   scripts/try-unlock.sh [kdbx-pfad] [keyfile-pfad]
#
# Fragt das Master-Passwort verdeckt ab (stdin, kein Echo) und versucht
# nacheinander: Passwort+Keyfile, dann Passwort allein. Sagt danach
# genau, welche Kombination der Tresor erwartet. Das Passwort landet
# nirgends — nur im RAM des Node-Prozesses.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE=/nix/store/3kfmdqn711fqcc2y1qnjssancqf7b36l-nodejs-24.22.2/bin/node
export PATH="$NODE/../bin:$PATH"

KDBX="${1:-$HOME/Cloud/KeeWeb/export.kdbx}"
KEY="${2:-$HOME/Cloud/KeeWeb/export.key}"
[ -r "$KDBX" ] || { echo "kdbx nicht lesbar: $KDBX"; exit 1; }
[ -r "$KEY" ] || { echo "keyfile nicht lesbar: $KEY"; exit 1; }

read -rs -p "Master-Passwort: " PW
echo

TMPDIR_RUN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_RUN" packages/extension/try-unlock-tmp.ts' EXIT
TRY_TS="packages/extension/try-unlock-tmp.ts"  # im Workspace → Node-Resolution für @kdbx-keychain/core
cat > "$TRY_TS" <<EOF
import { createKdbxDatabasePort } from '@kdbx-keychain/core';
import { readFileSync } from 'node:fs';

async function tryOpen(label: string, creds: { password?: string; keyFileBytes?: Uint8Array }): Promise<boolean> {
  try {
    const db = await createKdbxDatabasePort().open(
      new Uint8Array(readFileSync(process.env.KDBX_PATH!)),
      creds,
    );
    console.log(\`✓ \${label}: ERFOLGREICH (\${db.list().length} Einträge)\`);
    return true;
  } catch (e) {
    console.log(\`✗ \${label}: \${(e as Error).name}: \${(e as Error).message}\`);
    return false;
  }
}

async function run(): Promise<void> {
  const pw = process.env.KDBX_PW ?? '';
  const key = new Uint8Array(readFileSync(process.env.KEY_PATH!));
  await tryOpen('Passwort + Keyfile', { password: pw, keyFileBytes: key });
  await tryOpen('nur Passwort     ', { password: pw });
}
run();
EOF

KDBX_PATH="$KDBX" KEY_PATH="$KEY" KDBX_PW="$PW" \
  npx esbuild "$TRY_TS" --bundle --platform=node \
  "--alias:crypto=$PWD/packages/core/src/shims/crypto-shim.ts" \
  --outfile="$TMPDIR_RUN/try.js" --format=esm --log-level=error
KDBX_PATH="$KDBX" KEY_PATH="$KEY" KDBX_PW="$PW" "$NODE" "$TMPDIR_RUN/try.js"
