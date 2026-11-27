/**
 * Message-Vertrag zwischen Popup/Options (UI-Kontexte) und dem Background
 * (Vault). Content-Scripts erhalten einen separaten Typ (FILL_INTO_DOM),
 * der vom Router bewusst NICHT beantwortet wird.
 */
import type { EntryFields, KeychainEntry } from '@kdbx-keychain/core';
import type { Settings } from '@kdbx-keychain/core';

export type CopyableField = 'username' | 'password' | 'totp' | `custom:${string}`;

export interface SyncInfo {
  connected: boolean;
  rev: string;
  /** Lokale Mutationen, die noch nicht auf Dropbox sind. */
  dirty: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /** ADR-005: Konflikt nie still lösen — Dialog im Popup. */
  conflict: { remoteRev: string } | null;
}

export interface Snapshot {
  unlocked: boolean;
  settings: Settings;
  sync: SyncInfo;
}

export interface FillResult {
  username: boolean;
  password: boolean;
  totp: boolean;
}

export type TotpInfo = { code: string; remainingSeconds: number };

export type RuntimeMessage =
  | { type: 'UNLOCK'; password: string; keyFileBase64?: string }
  | { type: 'PREFILL_KEYFILE' }
  | { type: 'LOCK' }
  | { type: 'LOCK_STATE' }
  | { type: 'LIST'; query?: string }
  | { type: 'GET_ENTRY'; entryId: string }
  | { type: 'MATCH_URL'; url: string }
  /** Liefert den Feldwert — geschrieben wird im Popup (dort: Fokus + Geste). */
  | { type: 'READ_FIELD'; entryId: string; field: CopyableField }
  | { type: 'TOTP_NOW'; entryId: string }
  | { type: 'FILL'; entryId: string }
  | { type: 'CREATE_ENTRY'; fields: EntryFields }
  | { type: 'UPDATE_ENTRY'; entryId: string; patch: Partial<EntryFields>; clearTotp?: boolean }
  | { type: 'DELETE_ENTRY'; entryId: string }
  | { type: 'SYNC_PUSH' }
  | { type: 'SYNC_PULL'; force?: boolean }
  | { type: 'CONFLICT_RESOLVE'; mode: 'push' | 'pull' }
  | { type: 'CONNECT_DROPBOX' }
  | { type: 'SET_REFRESH_TOKEN'; refreshToken: string }
  | { type: 'DISCONNECT_DROPBOX' }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'GET_DROPBOX_APP' }
  | { type: 'SET_DROPBOX_APP'; appKey: string; appSecret: string }
  /** Nur Content-Script (via chrome.tabs.sendMessage) — Router lehnt ab. */
  | { type: 'FILL_INTO_DOM'; username?: string; password?: string; totp?: string };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
