/**
 * TOTP (RFC 6238) + Parser für die KeePass-Konventionen (ADR-008):
 * modernes `otp`-Feld (otpauth://-URI) und Legacy `TOTP Seed`/`TOTP Settings`.
 *
 * Läuft überall, wo WebCrypto existiert (Browser-Extension, Node ≥ 19) —
 * bewusst ohne DOM-Lib-Abhängigkeit (strukturierte Minimal-Typen).
 */

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpConfig {
  /** Base32-Secret (ohne Leerzeichen). */
  secret: string;
  /** 6 oder 8 Stellen (KeePassXC-üblich). */
  digits: number;
  /** Gültigkeitsfenster in Sekunden (üblich 30). */
  period: number;
  algorithm: TotpAlgorithm;
  /** Optionales Label (Issuer), nur für die Anzeige. */
  label?: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

interface SubtleLike {
  importKey(
    format: 'raw',
    key: Uint8Array,
    algorithm: { name: 'HMAC'; hash: string },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

export function subtle(): SubtleLike {
  const c = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  if (!c) throw new Error('WebCrypto (crypto.subtle) ist in dieser Umgebung nicht verfügbar');
  return c;
}

/** RFC 4648 Base32, tolerant: Leerzeichen, Kleinbuchstaben, optionales Padding. */
export function base32Decode(input: string): Uint8Array {
  const clean = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`ungültiges Base32-Zeichen: ${JSON.stringify(ch)}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function normalizeAlgorithm(raw: string | null | undefined): TotpAlgorithm | null {
  if (!raw) return null;
  const upper = raw.toUpperCase().replace('-', '');
  if (upper === 'SHA1') return 'SHA1';
  if (upper === 'SHA256') return 'SHA256';
  if (upper === 'SHA512') return 'SHA512';
  return null;
}

function clampInt(raw: string | null | undefined, fallback: number, max: number): number {
  const n = raw === null || raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > max) return fallback;
  return n;
}

const SECRET_CHARS = /^[A-Z2-7]+$/i;

/**
 * Parst eine KeePassXC-`otp`-Feld-URI:
 * `otpauth://totp/Label?secret=…&digits=…&period=…&algorithm=…`
 * Gibt außerdem nackten Base32-Secrets (manche Tools schreiben nur die ins
 * `otp`-Feld) Default-Parameter zurück. Alles andere → null.
 */
export function parseOtpUri(uri: string): TotpConfig | null {
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith('otpauth://steam/')) {
    // Steam-TOTP: bewusst noch nicht (Phase 6, ADR-008).
    return null;
  }
  const match = /^otpauth:\/\/totp\/([^?]*)\?(.*)$/i.exec(trimmed);
  if (match) {
    const [, rawLabel, query] = match as unknown as [string, string, string];
    const params = new URLSearchParams(query);
    const secretRaw = params.get('secret');
    if (!secretRaw) return null;
    let label = rawLabel;
    try {
      label = decodeURIComponent(rawLabel);
    } catch {
      /* Label so lassen */
    }
    const algorithm = normalizeAlgorithm(params.get('algorithm')) ?? 'SHA1';
    return {
      secret: secretRaw.replace(/[\s-]/g, ''),
      digits: clampInt(params.get('digits'), 6, 10),
      period: clampInt(params.get('period'), 30, 3600),
      algorithm,
      ...(label ? { label } : {}),
    };
  }
  // Nacktes Base32-Secret im otp-Feld.
  const bare = trimmed.replace(/[\s-]/g, '');
  if (bare.length >= 8 && SECRET_CHARS.test(bare)) {
    return { secret: bare, digits: 6, period: 30, algorithm: 'SHA1' };
  }
  return null;
}

/** Legacy-Konvention: `TOTP Seed` + `TOTP Settings` ("Periode;Stellen[;Algorithmus]"). */
export function parseLegacyTotp(
  seed: string | undefined,
  settings: string | undefined,
): TotpConfig | null {
  if (!seed || !seed.trim()) return null;
  const parts = (settings ?? '')
    .split(';')
    .map((s) => s.trim());
  return {
    secret: seed.replace(/[\s-]/g, ''),
    digits: clampInt(parts[1], 6, 10),
    period: clampInt(parts[0], 30, 3600),
    algorithm: normalizeAlgorithm(parts[2]) ?? 'SHA1',
  };
}

/** Umgekehrte Richtung: TotpConfig → otpauth-URI fürs `otp`-Feld. */
export function buildOtpUri(config: TotpConfig, label?: string): string {
  let uri = `otpauth://totp/${encodeURIComponent(label ?? 'Keychain')}?secret=${config.secret.replace(/[\s-]/g, '')}`;
  if (config.digits !== 6) uri += `&digits=${config.digits}`;
  if (config.period !== 30) uri += `&period=${config.period}`;
  if (config.algorithm !== 'SHA1') uri += `&algorithm=${config.algorithm}`;
  return uri;
}

/** RFC 6238: aktueller Code + Restlaufzeit (Sekunden) zum Zeitpunkt `atMs`. */
export async function generateTotp(
  config: TotpConfig,
  atMs: number = Date.now(),
): Promise<{ code: string; remainingSeconds: number }> {
  const key = base32Decode(config.secret);
  if (key.length === 0) throw new Error('leeres TOTP-Secret');

  const counter = Math.floor(atMs / 1000 / config.period);
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32), false);
  view.setUint32(4, counter >>> 0, false);

  const hashName = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[config.algorithm];
  const keyObj = await subtle().importKey(
    'raw',
    key,
    { name: 'HMAC', hash: hashName },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await subtle().sign('HMAC', keyObj, counterBytes));

  // Dynamic Truncation (RFC 4226, Abschnitt 5.3)
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  const code = (bin % 10 ** config.digits).toString().padStart(config.digits, '0');
  const remainingSeconds = config.period - (Math.floor(atMs / 1000) % config.period);
  return { code, remainingSeconds };
}
