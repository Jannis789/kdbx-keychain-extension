/**
 * Build-Defaults für die Dropbox-App (ADR-007): kommen als Platzhalter herein
 * und werden beim Build via esbuild `define` aus der agenix-Env ersetzt.
 * In Tests (vitest, ohne Define) sind die Bezeichner undefined — die
 * typeof-Guards liefern ''.
 * Runtime-Pflege über die Options-Seite schlägt diese Defaults (ADR-012,
 * siehe dropbox-config.ts).
 */

/** Dropbox-App-Key (client_id, öffentlich). */
export const APP_KEY: string = typeof __DROPBOX_APP_KEY__ === 'undefined' ? '' : __DROPBOX_APP_KEY__;

/** App-Secret (ADR-007-Amendment): nötig für den refresh-Grant (Confidential App). */
export const APP_SECRET: string = typeof __DROPBOX_APP_SECRET__ === 'undefined' ? '' : __DROPBOX_APP_SECRET__;
