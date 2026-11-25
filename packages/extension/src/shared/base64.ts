/**
 * Uint8Array <-> Base64 — umgebungsneutral (Service Worker, Event Page, Node).
 * chrome.storage und runtime-Messages sind JSON-basiert; ArrayBuffer kommt
 * dort nicht heil an, daher der String-Umweg.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]!;
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)]!;
    if (i + 2 < bytes.length) out += B64[b2 & 63]!;
  }
  return out;
}

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) LOOKUP[B64[i]!] = i;

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i + 3 < len; i += 4) {
    const n =
      (LOOKUP[clean[i]!]! << 18) |
      (LOOKUP[clean[i + 1]!]! << 12) |
      (LOOKUP[clean[i + 2]!]! << 6) |
      LOOKUP[clean[i + 3]!]!;
    out[o++] = (n >> 16) & 0xff;
    out[o++] = (n >> 8) & 0xff;
    out[o++] = n & 0xff;
  }
  const rest = len % 4;
  if (rest === 2) {
    const n = (LOOKUP[clean[len - 2]!]! << 18) | (LOOKUP[clean[len - 1]!]! << 12);
    out[o++] = (n >> 16) & 0xff;
  } else if (rest === 3) {
    const n =
      (LOOKUP[clean[len - 3]!]! << 18) |
      (LOOKUP[clean[len - 2]!]! << 12) |
      (LOOKUP[clean[len - 1]!]! << 6);
    out[o++] = (n >> 16) & 0xff;
    out[o++] = (n >> 8) & 0xff;
  }
  return out.subarray(0, o);
}
