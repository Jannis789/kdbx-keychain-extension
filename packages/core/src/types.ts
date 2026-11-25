/**
 * Domänenmodell von kdbx-keychain.
 *
 * Bewusst framework- und browser-frei: `core` läuft im Service Worker (Chrome),
 * in der Event Page (Firefox) und in Node (Tests). Alle Browser-APIs bleiben
 * außen vor (ADR-001) — sie gehören in `packages/extension`.
 */

// ---------- Einträge ----------

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

export interface CustomField {
  value: string;
  /** KDBX „protected field“: Wert liegt zusätzlich verschlüsselt im XML. */
  secret: boolean;
}

export interface EntryFields {
  title: string;
  username?: string;
  password?: string;
  /** Website-URL — Grundlage fürs Auto-Fill-Matching (ADR-006). */
  url?: string;
  notes?: string;
  totp?: TotpConfig;
  customFields?: Record<string, CustomField>;
  tags?: string[];
}

export interface KeychainEntry {
  /** KDBX-UUID als Hex-String (stabil, auch nach Sync). */
  id: string;
  groupId: string;
  fields: EntryFields;
  createdAt: number;
  modifiedAt: number;
}

// ---------- Datenbank ----------

export interface UnlockOptions {
  /** Master-Passwort. */
  password?: string;
  /** Roher Inhalt einer `.key`-Datei (Keyfile-Support, ADR-003). */
  keyFileBytes?: Uint8Array;
}

/** Fabrik für entsperrte Datenbanken. Implementierung (Phase 1): kdbxweb. */
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
  update(id: string, patch: Partial<EntryFields>): KeychainEntry;
  remove(id: string): void;
  /** Neu verschlüsseln und als KDBX-Bytes ausgeben (KDF/Argon2 → async). */
  serialize(): Promise<Uint8Array>;
}

// ---------- Cloud (Dropbox) ----------

export type CloudPutResult =
  | { ok: true; newRev: string }
  | { ok: false; reason: 'conflict'; currentRev: string }
  | { ok: false; reason: 'network'; detail?: string };

/**
 * Cloud-Adapter-Interface. Implementierung (Phase 2): Dropbox REST + PKCE.
 * Bewusst generisch, falls später WebDAV/S3 o. ä. dazukommen sollen.
 */
export interface CloudPort {
  fetchLatest(remotePath: string): Promise<{ bytes: Uint8Array; rev: string }>;
  /** Optimistische Nebenläufigkeit: nur schreiben, wenn `rev` unverändert (ADR-005). */
  putIfUnchanged(
    remotePath: string,
    bytes: Uint8Array,
    expectedRev: string,
  ): Promise<CloudPutResult>;
}
