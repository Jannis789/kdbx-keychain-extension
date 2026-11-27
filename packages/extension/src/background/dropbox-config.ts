/**
 * Dropbox-App-Credentials zur Laufzeit (ADR-012): die Options-Seite pflegt
 * App-Key/-Secret in chrome.storage.local; die Build-Injection (ADR-007)
 * bleibt Dev-Prefill/Fallback. Ein sync-Spiegel (Cache) bedient die
 * synchrone CloudFactory — geladen wird er, bevor die Vault-Init läuft
 * (VaultDeps.ready).
 */
import { APP_KEY, APP_SECRET } from './app-key';

export interface DropboxAppConfig {
  appKey: string;
  appSecret: string;
}

const STORAGE_KEY = 'kdbx.dropboxApp';

/** Pure Normalisierung: beliebiges Storage-Fragment → bereinigte Config. */
export function parseDropboxAppConfig(input: unknown): DropboxAppConfig {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return { appKey: clean(src.appKey), appSecret: clean(src.appSecret) };
}

/** Pure Merge-Semantik: leere Patch-Felder löschen (→ Build-Fallback greift). */
export function mergeDropboxAppConfig(
  current: DropboxAppConfig,
  patch: Partial<DropboxAppConfig>,
): DropboxAppConfig {
  const clean = (v: string | undefined): string => (typeof v === 'string' ? v.trim() : '');
  return {
    appKey: clean(patch.appKey ?? current.appKey),
    appSecret: clean(patch.appSecret ?? current.appSecret),
  };
}

let cache: DropboxAppConfig = { appKey: '', appSecret: '' };

/** Für den Lade-Fluss und Tests: Cache direkt setzen (bereinigt). */
export function setDropboxAppConfigCache(next: DropboxAppConfig): void {
  cache = parseDropboxAppConfig(next);
}

export async function loadDropboxAppConfig(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  setDropboxAppConfigCache(parseDropboxAppConfig(stored[STORAGE_KEY]));
}

export async function saveDropboxAppConfig(patch: Partial<DropboxAppConfig>): Promise<DropboxAppConfig> {
  const next = mergeDropboxAppConfig(cache, patch);
  setDropboxAppConfigCache(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Gepflegter Stand ohne Build-Fallback — für die Options-Anzeige. */
export function dropboxAppConfig(): DropboxAppConfig {
  return cache;
}

/** Gestaffelt: Options-Pflege schlägt Build-Injection (ADR-012 > ADR-007). */
export function resolvedAppKey(): string {
  return cache.appKey || APP_KEY;
}

export function resolvedAppSecret(): string {
  return cache.appSecret || APP_SECRET;
}

export function hasResolvedAppKey(): boolean {
  const key = resolvedAppKey();
  return key !== '' && !key.startsWith('__');
}
