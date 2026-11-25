export * from './types';

// Phase 1 fügt hier hinzu:
//   export * from './kdbx/database'   // DatabasePort via kdbxweb + Argon2-WASM
//   export * from './totp'            // RFC 6238
//   export * from './url-matching'    // eTLD+1-Heuristik
// Bewusst NICHT in core: Browser-APIs, Dropbox-HTTP, UI (liegen in packages/extension).
