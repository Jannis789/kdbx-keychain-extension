/**
 * Dropbox-Implementierung von `CloudPort` (ADR-002, ADR-005).
 *
 * Läuft identisch im Browser (Extension) und in Node (Tests) — nur
 * fetch + WebCrypto. OAuth 2.0 mit PKCE: der App-Key wird injiziert
 * (ADR-007), das App-Secret taucht hier NIEMALS auf.
 *
 * Konflikt-Strategie: `putIfUnchanged` nutzt Dropbox' `mode: update` mit
 * erwarteter rev — bei Fremd-Änderung (409) wird die aktuelle rev gelesen
 * und als Konflikt zurückgegeben, nie still überschrieben.
 */
import { subtle } from '../totp';
import type { CloudPort, CloudPutResult } from '../types';

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const API = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64[b0 >> 2]! + BASE64[((b0 & 3) << 4) | (b1 >> 4)]!;
    if (i + 1 < bytes.length) out += BASE64[((b1 & 15) << 2) | (b2 >> 6)]!;
    if (i + 2 < bytes.length) out += BASE64[b2 & 63]!;
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

// ---------- PKCE (RFC 7636) ----------

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

export async function generatePkce(): Promise<Pkce> {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues nicht verfügbar');
  const rnd = new Uint8Array(32);
  c.getRandomValues(rnd);
  const verifier = base64UrlEncode(rnd);
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge, state: base64UrlEncode(rnd.slice(0, 16)) };
}

interface CryptoLike {
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function buildAuthUrl(opts: {
  appKey: string;
  redirectUri: string;
  pkce: Pkce;
}): string {
  const q = new URLSearchParams({
    client_id: opts.appKey,
    response_type: 'code',
    token_access_type: 'offline',
    code_challenge: opts.pkce.challenge,
    code_challenge_method: 'S256',
    redirect_uri: opts.redirectUri,
    state: opts.pkce.state,
  });
  return `${AUTH_URL}?${q}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function readTokenResponse(res: Response): Promise<TokenResponse> {
  if (!res.ok) {
    throw new Error(`dropbox token endpoint (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? '', expiresIn: j.expires_in ?? 14400 };
}

/** Authorization-Code gegen Token tauschen (PKCE — ohne client_secret). */
export async function exchangeCode(opts: {
  appKey: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const res = await (opts.fetchImpl ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      grant_type: 'authorization_code',
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
      client_id: opts.appKey,
    }),
  });
  return readTokenResponse(res);
}

// ---------- CloudPort ----------

export interface DropboxOptions {
  appKey: string;
  /** Refresh-Token (kann bei Rotation aktualisiert werden). */
  refreshToken: string;
  /** Wird nach jedem Refresh informiert — hier den Token persistieren! */
  onTokenRefreshed?(tokens: { accessToken: string; refreshToken: string; expiresAt: number }): void;
  /** Nur für Tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class DropboxCloud implements CloudPort {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly opts: DropboxOptions) {}

  private f(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private async token(): Promise<string> {
    const now = this.now();
    if (this.accessToken && now < this.expiresAt - 60_000) return this.accessToken;
    const res = await this.f()(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.opts.refreshToken,
        client_id: this.opts.appKey,
      }),
    });
    const tokens = await readTokenResponse(res);
    this.accessToken = tokens.accessToken;
    this.expiresAt = now + tokens.expiresIn * 1000;
    if (tokens.refreshToken && tokens.refreshToken !== this.opts.refreshToken) {
      this.opts.refreshToken = tokens.refreshToken;
    }
    this.opts.onTokenRefreshed?.({
      accessToken: this.accessToken,
      refreshToken: this.opts.refreshToken,
      expiresAt: this.expiresAt,
    });
    return this.accessToken;
  }

  private async currentRev(path: string): Promise<string> {
    const at = await this.token();
    const res = await this.f()(`${API}files/get_metadata`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, include_deleted: false }),
    });
    if (!res.ok) return '';
    const j = (await res.json()) as { rev?: string };
    return j.rev ?? '';
  }

  async fetchLatest(remotePath: string): Promise<{ bytes: Uint8Array; rev: string }> {
    const at = await this.token();
    const res = await this.f()(`${CONTENT}files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${at}`,
        'Dropbox-API-Arg': JSON.stringify({ path: remotePath }),
      },
    });
    if (!res.ok) {
      throw new Error(`dropbox download fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const meta = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}') as { rev?: string };
    return { bytes: new Uint8Array(await res.arrayBuffer()), rev: meta.rev ?? '' };
  }

  async putIfUnchanged(
    remotePath: string,
    bytes: Uint8Array,
    expectedRev: string,
  ): Promise<CloudPutResult> {
    const at = await this.token();
    const arg = {
      path: remotePath,
      mode: { '.tag': 'update', update: expectedRev },
      autorename: false,
      mute: false,
    };
    const res = await this.f()(`${CONTENT}files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${at}`,
        'Dropbox-API-Arg': JSON.stringify(arg),
        'Content-Type': 'application/octet-stream',
      },
      // Kopie, damit .buffer exakt die Nutzdaten enthält (Views könnten größer sein)
      body: bytes.slice().buffer as ArrayBuffer,
    });
    if (res.ok) {
      const meta = (await res.json()) as { rev?: string };
      return { ok: true, newRev: meta.rev ?? '' };
    }
    if (res.status === 409) {
      return { ok: false, reason: 'conflict', currentRev: await this.currentRev(remotePath) };
    }
    return { ok: false, reason: 'network', detail: (await res.text()).slice(0, 200) };
  }
}
