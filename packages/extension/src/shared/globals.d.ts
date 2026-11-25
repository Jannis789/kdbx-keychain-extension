/**
 * Build-Injection (ADR-007): Der Dropbox App-Key kommt als Platzhalter in den
 * Quellcode und wird beim Build via esbuild `define` aus der agenix-Env
 * ersetzt. Das App-Secret taucht im Browser-Bundle bewusst NIEMALS auf
 * (PKCE braucht nur den Key).
 */
declare const __DROPBOX_APP_KEY__: string;
