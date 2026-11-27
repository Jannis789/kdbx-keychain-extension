/**
 * Nutzereinstellungen: Auto-Lock, Dropbox-Pfad. Pure — ohne Browser testbar.
 */

export interface Settings {
  /** Minuten Inaktivität bis Auto-Lock; 0 = nie (ADR-004: Default 15). */
  autoLockMinutes: number;
  /** KDBX-Pfad im Cloud-Speicher (Dropbox-Root relativ). */
  remotePath: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  // Repo-Fallback; Host-Deploy (ADR-012, managed.remotePath) übersteuert via
  // Seed vor mergeSettings — siehe vault.doInit.
  remotePath: '/kdbx-keychain/test.kdbx',
};

/**
 * Patch anwenden, sonst nichts: ungültige Werte werden abgelehnt, nicht
 * zurechtgebogen (die Options-Seite zeigt die Meldung als Toast).
 */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...current, ...patch };
  if (
    !Number.isInteger(next.autoLockMinutes) ||
    next.autoLockMinutes < 0 ||
    next.autoLockMinutes > 1440
  ) {
    throw new Error(
      `Auto-Lock: ganze Minuten 0–1440 erwartet, kam: ${String(next.autoLockMinutes)}`,
    );
  }
  if (typeof next.remotePath !== 'string' || !next.remotePath.startsWith('/')) {
    throw new Error(`Dropbox-Pfad muss im Root beginnen ("/…"), kam: "${String(next.remotePath)}"`);
  }
  return next;
}
