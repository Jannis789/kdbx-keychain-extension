/**
 * Browser-Stub für den Node-`crypto`-External von kdbxweb (ADR-003-Bundle).
 * kdbxweb bevorzugt WebCrypto (SubtleCrypto/WebCrypto.getRandomValues);
 * die Node-APIs (randomBytes, createCipheriv) sind nur Fallback-Pfade, die
 * im Browser nie aktiv werden. Der Stub macht den UMD-Bundle-Alias möglich,
 * ohne funktionale Abstriche.
 */
const g = globalThis.crypto;

export default {
  webcrypto: g,
  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    g.getRandomValues(bytes);
    return bytes;
  },
};
