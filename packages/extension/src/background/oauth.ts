/**
 * Dropbox-Connect aus der Extension heraus: OAuth 2.0 + PKCE (ADR-002/007).
 * Nur der App-Key wird gebraucht (Build-Injection, ADR-007) — kein Secret.
 *
 * Redirect-URI: chrome.identity.getRedirectURL() liefert
 * https://<extension-id>.chromiumapp.org/ — die Extension-ID ist über das
 * öffentliche "key"-Feld im Manifest gepinnt, damit die URI in der
 * Dropbox-App-Konsole einmalig eingetragen werden kann.
 */
import { buildAuthUrl, exchangeCode, generatePkce } from '@kdbx-keychain/core';
import { APP_KEY, hasAppKey } from './app-key';
import type { Vault } from './vault';

export function dropboxRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export async function connectDropboxPkce(vault: Vault): Promise<void> {
  if (typeof chrome.identity === 'undefined') {
    throw new Error('chrome.identity nicht verfügbar');
  }
  if (!hasAppKey()) {
    throw new Error('DROPBOX_APP_KEY fehlt — Build ohne ADR-007-Injection ausgeführt.');
  }
  const pkce = await generatePkce();
  const redirectUri = dropboxRedirectUri();
  const url = buildAuthUrl({ appKey: APP_KEY, redirectUri, pkce });
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
    appKey: APP_KEY,
    code,
    redirectUri,
    codeVerifier: pkce.verifier,
  });
  if (!tokens.refreshToken) throw new Error('Dropbox lieferte keinen refresh_token.');
  await vault.setRefreshToken(tokens.refreshToken);
}
