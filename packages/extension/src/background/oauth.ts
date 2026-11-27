/**
 * Dropbox-Connect aus der Extension heraus: OAuth 2.0 + PKCE (ADR-002).
 * Der App-Key kommt aus der Options-Pflege bzw. dem Host-Deploy (ADR-012) —
 * ein Secret gehört nie in den Auth-Flow.
 *
 * Redirect-URI: chrome.identity.getRedirectURL() liefert
 * https://<extension-id>.chromiumapp.org/ (Firefox: …extensions.allizom.org/) — die
 * Extension-ID ist über das öffentliche "key"-Feld im Manifest gepinnt, damit
 * die URI in der Dropbox-App-Konsole einmalig eingetragen werden kann.
 */
import { buildAuthUrl, exchangeCode, generatePkce } from '@kdbx-keychain/core';
import { hasResolvedAppKey, resolvedAppKey } from './dropbox-config';
import type { Vault } from './vault';

export function dropboxRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export async function connectDropboxPkce(vault: Vault): Promise<void> {
  if (!hasResolvedAppKey()) {
    throw new Error('Kein Dropbox App-Key — in den Einstellungen pflegen oder per Host-Deploy liefern.');
  }
  const pkce = await generatePkce();
  const redirectUri = dropboxRedirectUri();
  const appKey = resolvedAppKey();
  const url = buildAuthUrl({ appKey, redirectUri, pkce });
  const redirect = await new Promise<string | undefined>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
  if (!redirect) throw new Error('OAuth-Fenster ohne Ergebnis geschlossen.');
  const parsed = new URL(redirect);
  const code = parsed.searchParams.get('code');
  if (!code) throw new Error('OAuth abgebrochen — kein Authorization-Code.');
  if (parsed.searchParams.get('state') !== pkce.state) {
    throw new Error('OAuth-State-Mismatch — Abbruch.');
  }
  const tokens = await exchangeCode({
    appKey,
    code,
    redirectUri,
    codeVerifier: pkce.verifier,
  });
  if (!tokens.refreshToken) throw new Error('Dropbox lieferte keinen refresh_token.');
  await vault.setRefreshToken(tokens.refreshToken);
}
