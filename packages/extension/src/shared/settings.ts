/**
 * Nutzereinstellungen (Phase 3): Auto-Lock, Clipboard-Auto-Clear,
 * Dropbox-Pfad. Bewusst pure — Normalisierung testbar ohne Browser.
 */

export interface Settings {
  /** Minuten Inaktivität bis Auto-Lock; 0 = nie (ADR-004: Default 15). */
  autoLockMinutes: number;
  /** Sekunden bis Clipboard-Auto-Clear; 0 = nie (ADR-009: Default 20). */
  clipboardClearSeconds: number;
  /** KDBX-Pfad im Cloud-Speicher (Dropbox-Root relativ). */
  remotePath: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  clipboardClearSeconds: 20,
  // Repo-Fallback; Host-Deploy (ADR-012, managed.remotePath) übersteuert via
  // Seed vor mergeSettings — siehe vault.doInit.
  remotePath: '/kdbx-keychain/test.kdbx',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Defensiv: beliebige (teils korrupte) Storage-Fragmente → gültiges Settings. */
export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const src = input ?? {};
  let remotePath =
    typeof src.remotePath === 'string' && src.remotePath.trim() !== ''
      ? src.remotePath.trim()
      : DEFAULT_SETTINGS.remotePath;
  if (!remotePath.startsWith('/')) remotePath = '/' + remotePath;
  return {
    autoLockMinutes: clampInt(src.autoLockMinutes, 0, 1440, DEFAULT_SETTINGS.autoLockMinutes),
    clipboardClearSeconds: clampInt(
      src.clipboardClearSeconds,
      0,
      600,
      DEFAULT_SETTINGS.clipboardClearSeconds,
    ),
    remotePath,
  };
}

export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return normalizeSettings({ ...current, ...patch });
}
