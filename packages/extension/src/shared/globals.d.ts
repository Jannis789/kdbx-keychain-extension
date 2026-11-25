/**
 * Build-Injection (ADR-007): Der Dropbox App-Key kommt als Platzhalter in den
 * Quellcode und wird beim Build via esbuild `define` aus der agenix-Env
 * ersetzt. Das App-Secret taucht im Browser-Bundle bewusst NIEMALS auf
 * (PKCE braucht nur den Key).
 */
declare const __DROPBOX_APP_KEY__: string;
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
