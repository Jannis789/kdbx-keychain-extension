/**
 * Port: Cloud-Speicher. Implementierung: `adapters/dropbox.ts` (ADR-002/ADR-005).
 * Bewusst nur zwei Operationen — mehr braucht der Sync nicht.
 */

export type CloudPutResult =
  | { ok: true; newRev: string }
  | { ok: false; reason: 'conflict'; currentRev: string }
  | { ok: false; reason: 'network'; detail?: string };

export interface CloudPort {
  fetchLatest(remotePath: string): Promise<{ bytes: Uint8Array; rev: string }>;
  /** Optimistische Nebenläufigkeit: nur schreiben, wenn `rev` unverändert (ADR-005). */
  putIfUnchanged(
    remotePath: string,
    bytes: Uint8Array,
    expectedRev: string,
  ): Promise<CloudPutResult>;
}
