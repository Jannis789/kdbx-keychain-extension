/**
 * Eintrags-Modell: was ein Keychain-Eintrag fachlich ist (ADR-006/ADR-008).
 * Framework- und browser-frei — läuft in Service Worker, Event Page und Node.
 */
import type { TotpConfig } from './totp';

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

/**
 * Teil-Update: ein explizit gesetztes `undefined` löscht das Feld. Nötig, weil
 * die IPC-Schicht (`chrome.runtime`) undefined-Keys verwirft — der Aufrufer
 * muss „löschen" also in-process ausdrücken können (nur `'totp' in patch`).
 */
export type EntryPatch = { [K in keyof EntryFields]?: EntryFields[K] | undefined };

export interface KeychainEntry {
  /** KDBX-UUID als Hex-String (stabil, auch nach Sync). */
  id: string;
  groupId: string;
  fields: EntryFields;
  createdAt: number;
  modifiedAt: number;
}
