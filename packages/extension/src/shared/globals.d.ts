/**
 * Build-Injection (ADR-007, Amendment): Der Dropbox App-Key kommt als
 * Platzhalter in den Quellcode und wird beim Build via esbuild `define` aus
 * der agenix-Env ersetzt. Das App-Secret taucht seit dem Amendment AUCH im
 * Bundle auf (Confidential App: der refresh_token-Grant verlangt
 * client_secret — empirisch 400 ohne Secret). Quelle bleibt die agenix-Env;
 * das dist/-Artefakt ist gitignored und nur lokal.
 */
declare const __DROPBOX_APP_KEY__: string;
declare const __DROPBOX_APP_SECRET__: string | undefined;
/**
 * Optionale Build-Defaults (gleiche Injektions-Mechanik, agenix-Env):
 *   __DEFAULT_REMOTE_PATH__  → voreingestellter KDBX-Pfad (kein Secret)
 *   __DROPBOX_REFRESH_TOKEN__ → Dropbox-Session-Token (Secret; landet nur im
 *   lokalen dist/-Artefakt, das Repo bleibt clean — dist/ ist gitignored)
 * In Tests/vite (ohne esbuild-Define) sind die Bezeichner undefined — deshalb
 * immer `typeof`-guards in build-defaults.ts.
 */
declare const __DEFAULT_REMOTE_PATH__: string | undefined;
declare const __DROPBOX_REFRESH_TOKEN__: string | undefined;
