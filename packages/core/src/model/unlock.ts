/** Zugangsdaten zum Entsperren (ADR-003): Passwort, Keyfile oder beides. */
export interface UnlockOptions {
  /** Master-Passwort. */
  password?: string;
  /** Roher Inhalt einer `.key`-Datei (Keyfile-Support, ADR-003). */
  keyFileBytes?: Uint8Array;
}
