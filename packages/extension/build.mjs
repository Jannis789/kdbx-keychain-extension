#!/usr/bin/env node
/**
 * Build (ADR-001/007): esbuild-Bundles + Manifest-Transform für beide Ziele.
 *
 *   node build.mjs chrome|firefox|all
 *
 * Output: dist/chrome, dist/firefox (unpacked, load-ready).
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');

const target = process.argv[2] ?? 'all';
const targets = target === 'all' ? ['chrome', 'firefox'] : [target];

const entryPoints = {
  background: join(src, 'background/main.ts'),
  content: join(src, 'content/content.ts'),
  'popup/popup': join(src, 'popup/popup.tsx'),
  'options/options': join(src, 'options/options.ts'),
  'offscreen/clipboard': join(src, 'offscreen/clipboard.ts'),
};

const staticFiles = (name) => [
  ['managed-schema.json', 'managed-schema.json'], // ADR-012: Schema für chrome.storage.managed (Host-Deploy)
  ['popup/index.html', 'popup/index.html'],
  ['popup/style.css', 'popup/style.css'],
  ['options/index.html', 'options/index.html'],
  // Offscreen-Dokument nur für Chrome (Firefox nutzt die Event-Page direkt)
  ...(name === 'chrome' ? [['offscreen/clipboard.html', 'offscreen/clipboard.html']] : []),
];

function copyStatic(out, name) {
  for (const [from, to] of staticFiles(name)) {
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
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  });

  // Manifest-Transform: Chrome bekommt klassischen Service Worker (IIFE-Bundle),
  // Firefox eine Event-Page mit scripts[].
  const manifest = JSON.parse(readFileSync(join(here, `manifest.${name}.json`), 'utf8'));
  manifest.background =
    name === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

  copyStatic(out, name);
  console.log(`✓ dist/${name} gebaut`);
}
