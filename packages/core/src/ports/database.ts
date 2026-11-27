/**
 * Port: KDBX-Persistenz. Implementierung: `adapters/kdbx.ts` (kdbxweb, ADR-003).
 * Die Extension kennt nur diese Schnittstelle — daher ist der Vault mit einem
 * Fake-Port testbar.
 */
import type { EntryFields, EntryPatch, KeychainEntry } from '../model/entry';
import type { TotpConfig } from '../model/totp';
import type { UnlockOptions } from '../model/unlock';

/** Fabrik für entsperrte Datenbanken. */
export interface DatabasePort {
  open(bytes: Uint8Array, credentials: UnlockOptions): Promise<UnlockedDatabase>;
}

export interface UnlockedDatabase {
  list(): KeychainEntry[];
  search(query: string): KeychainEntry[];
  /** eTLD+1-Heuristik fürs Auto-Fill (ADR-006). */
  matchUrl(url: string): KeychainEntry[];
  totp(id: string): TotpConfig | null;
  /** RFC 6238: aktueller Code + Restlaufzeit fürs UI (WebCrypto → async). */
  totpNow(id: string): Promise<{ code: string; remainingSeconds: number } | null>;
  create(fields: EntryFields, groupId?: string): KeychainEntry;
  update(id: string, patch: EntryPatch): KeychainEntry;
  remove(id: string): void;
  /** Neu verschlüsseln und als KDBX-Bytes ausgeben (KDF/Argon2 → async). */
  serialize(): Promise<Uint8Array>;
}
