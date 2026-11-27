import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';

describe('encodeBase64/decodeBase64', () => {
  it('rundet alle Bytewerte fehlerfrei', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it('rundet kürzeste Eingaben (1–5 Bytes, Padding-Freiheit)', () => {
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) % 256;
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
  });

  it('erzeugt klassisches Standard-Base64 (Vektor)', () => {
    expect(encodeBase64(new TextEncoder().encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('wirft bei kaputter Eingabe, statt sie still zu reparieren', () => {
    expect(() => decodeBase64('kein base64!')).toThrow();
  });
});
