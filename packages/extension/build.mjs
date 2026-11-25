#!/usr/bin/env node
/**
 * Build (ADR-001/007): esbuild-Bundles + Manifest-Transform für beide Ziele.
 *
 *   node build.mjs chrome|firefox|all
 *
 * ADR-007: __DROPBOX_APP_KEY__ wird aus der Umgebung (DROPBOX_APP_KEY,
 * z. B. aus /run/agenix/dropbox-keychain-env) injiziert. Ohne Env bleibt
 * der Platzhalter stehen — Connect-Funktionen lehnen dann ab.
 * Output: dist/chrome, dist/firefox (unpacked, load-ready).
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');

const APP_KEY = process.env.DROPBOX_APP_KEY ?? '';
if (!APP_KEY || APP_KEY.startsWith('__')) {
  console.warn('⚠  Kein DROPBOX_APP_KEY gesetzt — Placeholder bleibt im Bundle (ADR-007).');
}
const REMOTE_PATH = process.env.DEFAULT_REMOTE_PATH ?? '';
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN ?? '';

const target = process.argv[2] ?? 'all';
const targets = target === 'all' ? ['chrome', 'firefox'] : [target];

const entryPoints = {
  background: join(src, 'background/main.ts'),
  content: join(src, 'content/content.ts'),
  'popup/popup': join(src, 'popup/popup.ts'),
  'options/options': join(src, 'options/options.ts'),
  'offscreen/clipboard': join(src, 'offscreen/clipboard.ts'),
};

const staticFiles = [
  ['popup/index.html', 'popup/index.html'],
  ['popup/style.css', 'popup/style.css'],
  ['options/index.html', 'options/index.html'],
  ['offscreen/clipboard.html', 'offscreen/clipboard.html'],
];

function copyStatic(out) {
  for (const [from, to] of staticFiles) {
    const dest = join(out, to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(src, from), dest);
  }
}

for (const name of targets) {
  const out = join(here, 'dist', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const browserTarget = name === 'chrome' ? 'chrome116' : 'firefox127';

  await build({
    entryPoints,
    outdir: out,
    bundle: true,
    format: 'iife',
    target: [browserTarget],
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    alias: {
      // kdbxweb-UMD externals: Node-'crypto' → WebCrypto-Stub; @xmldom/xmldom
      // wird als echtes Paket gebundelt (SW hat keinen DOMParser).
      crypto: join(src, 'shims/crypto-shim.ts'),
    },
    define: {
      __DROPBOX_APP_KEY__: JSON.stringify(APP_KEY),
      __DEFAULT_REMOTE_PATH__: JSON.stringify(REMOTE_PATH),
      __DROPBOX_REFRESH_TOKEN__: JSON.stringify(REFRESH_TOKEN),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  });

  // Manifest-Transform: Chrome bekommt klassischen Service Worker (IIFE-Bundle),
  // Firefox eine Event-Page mit scripts[].
  const manifest = JSON.parse(readFileSync(join(here, `manifest.${name}.json`), 'utf8'));
  manifest.background =
    name === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

  copyStatic(out);
  console.log(`✓ dist/${name} gebaut`);
}
