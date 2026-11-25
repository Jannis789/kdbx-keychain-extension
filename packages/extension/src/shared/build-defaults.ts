/**
 * Build-Defaults aus der agenix-Env (ADR-007-Injektion).
 * Platzhalter/undefined → null: dann gelten die Repo-Defaults und der User
 * konfiguriert per Options-Seite.
 */

function injected(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && !value.startsWith('__')
    ? value
    : null;
}

/** Voreingestellter KDBX-Pfad (kein Secret). */
export const BUILD_DEFAULT_REMOTE_PATH: string | null = injected(
  typeof __DEFAULT_REMOTE_PATH__ === 'undefined' ? undefined : __DEFAULT_REMOTE_PATH__,
);

/** Dropbox-Refresh-Token (Secret, nur im lokalen Build-Artefakt). */
export const BUILD_REFRESH_TOKEN: string | null = injected(
  typeof __DROPBOX_REFRESH_TOKEN__ === 'undefined' ? undefined : __DROPBOX_REFRESH_TOKEN__,
);
