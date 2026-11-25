/**
 * Dropbox App-Key (ADR-007): kommt als Build-Platzhalter herein und wird
 * beim Build aus der agenix-Env ersetzt. Fehlt er (naiver Build), bleibt
 * der Platzhalter stehen und die Connect-Funktionen lehnen ab.
 */
export const APP_KEY: string = __DROPBOX_APP_KEY__;

/** true, wenn ein echter App-Key injiziert wurde. */
export function hasAppKey(): boolean {
  return APP_KEY !== '' && !APP_KEY.startsWith('__');
}
