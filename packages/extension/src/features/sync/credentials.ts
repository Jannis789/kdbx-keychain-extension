/**
 * Dropbox-App-Credentials zur Laufzeit (ADR-012): die Options-Seite pflegt
 * App-Key/-Secret in chrome.storage.local, der Host liefert dieselben Werte
 * plus refreshToken/remotePath per chrome.storage.managed. Ein Cache bedient
 * die synchrone CloudFactory — geladen, bevor die Vault-Init läuft
 * (VaultDeps.ready).
 *
 * Vertrauensgrenze (bewusst schmal): beide Quellen schreiben nur wir selbst —
 * `chrome.storage.local` über `saveDropboxAppConfig`, `chrome.storage.managed`
 * über die nix-Activation (`jq --arg` erzeugt immer Strings). Es gibt daher
 * weder Typ-Wiederherstellung beim Lesen noch Merge-Logik beim Schreiben:
 * falscher Inhalt ist ein Bug, der auffallen soll, kein Zustand, den wir
 * wegdefinieren (kein "defensive programming" als Fehler-Ersatz).
 *
 * Whitespace schneidet die Options-Seite an ihren Eingabefeldern ab — dort
 * entsteht er (Zwischenablage), nicht hier.
 */
export interface DropboxAppConfig {
  appKey: string;
  appSecret: string;
}

/** Host-Deploy (nix/Enterprise-Policy): chrome.storage.managed. */
export interface ManagedConfig extends DropboxAppConfig {
  refreshToken: string;
  remotePath: string;
}

const STORAGE_KEY = 'kdbx.dropboxApp';
const MANAGED_KEYS: (keyof ManagedConfig)[] = ['appKey', 'appSecret', 'refreshToken', 'remotePath'];

const EMPTY_APP: DropboxAppConfig = { appKey: '', appSecret: '' };
const EMPTY_MANAGED: ManagedConfig = { ...EMPTY_APP, refreshToken: '', remotePath: '' };

let cache: DropboxAppConfig = EMPTY_APP;
let managed: ManagedConfig = EMPTY_MANAGED;

export async function loadDropboxAppConfig(): Promise<void> {
  // Host-Level zuerst (nix/Enterprise-Policy) — kein Managed-Deploy ist ein
  // legitimer Zustand (ExtensionError des Browsers), kein Fehler.
  const hostValues = await new Promise<Partial<ManagedConfig> | undefined>((resolve) => {
    chrome.storage.managed.get(MANAGED_KEYS, (res) => {
      void chrome.runtime.lastError;
      resolve(res as Partial<ManagedConfig> | undefined);
    });
  });
  managed = { ...EMPTY_MANAGED, ...hostValues };

  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    | DropboxAppConfig
    | undefined;
  cache = stored ?? EMPTY_APP;
}

export async function saveDropboxAppConfig(next: DropboxAppConfig): Promise<void> {
  cache = next;
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

/** Gepflegter Stand ohne Host-Deploy — für die Options-Anzeige. */
export function dropboxAppConfig(): DropboxAppConfig {
  return cache;
}

/** Gestaffelt (ADR-012): Options-Pflege > Host-Deploy (managed). */
export function resolvedAppKey(): string {
  return cache.appKey || managed.appKey;
}

export function resolvedAppSecret(): string {
  return cache.appSecret || managed.appSecret;
}

export function resolvedRefreshToken(): string {
  return managed.refreshToken;
}

export function resolvedRemotePath(): string {
  return managed.remotePath;
}

export function hasResolvedAppKey(): boolean {
  return resolvedAppKey() !== '';
}
