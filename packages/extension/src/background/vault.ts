/**
 * VaultService — das Herz der Extension.
 *
 * Stay-open (ADR-004): Master-Passwort/Keyfile + KDBX-Ciphertext liegen
 * ausschließlich in storage.session (RAM, stirbt mit dem Browser). Der
 * Service-Worker kann jederzeit sterben — beim nächsten Zugriff wird aus
 * der Session rekonstruiert (deshalb „stay open“ über SW-Neustarts).
 * Auf Disk (storage.local) liegt NUR der verschlüsselte KDBX-Cache, nie
 * ein Schlüssel.
 *
 * Sync (ADR-005): nach jeder Mutation sofortiger rev-basierter Push.
 * Fremde rev → Konflikt-Zustand (lokal + remote bytes), nie stilles
 * Überschreiben; Auflösung nur per explizitem Dialog (Popup).
 *
 * Diese Klasse ist bewusst browser-frei: Browser-APIs kommen als Ports
 * (KVStore, AlarmScheduler, CloudFactory) herein und sind in Tests fakebar.
 */
import type {
  CloudPort,
  DatabasePort,
  EntryFields,
  KeychainEntry,
  UnlockOptions,
  UnlockedDatabase,
} from '@kdbx-keychain/core';
import { decodeBase64, encodeBase64 } from '../shared/base64';
import { BUILD_REFRESH_TOKEN } from '../shared/build-defaults';
import type { CopyableField, Snapshot, SyncInfo, TotpInfo } from '../shared/messages';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../shared/settings';

export interface KVStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AlarmScheduler {
  create(name: string, delaySeconds: number): Promise<void>;
  clear(name: string): Promise<void>;
}

export type CloudFactory = (opts: {
  refreshToken: string;
  onTokenRefreshed(refreshToken: string): void;
}) => CloudPort | null;

export interface VaultDeps {
  session: KVStore;
  local: KVStore;
  alarms: AlarmScheduler;
  port: DatabasePort;
  cloudFactory: CloudFactory;
  now?(): number;
}

interface StoredCreds {
  password?: string;
  keyFileBase64?: string;
}

interface ConflictState {
  localBytes: Uint8Array;
  remoteBytes: Uint8Array;
  remoteRev: string;
}

export const AUTO_LOCK_ALARM = 'kdbx-auto-lock';

const KEY = {
  creds: 'kdbx.creds',
  bytes: 'kdbx.bytes',
  activity: 'kdbx.activity',
  cache: 'kdbx.cache',
  rev: 'kdbx.rev',
  lastSync: 'kdbx.lastSyncAt',
  settings: 'kdbx.settings',
  token: 'kdbx.refreshToken',
  dirty: 'kdbx.dirty',
} as const;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toUnlockOptions(stored: StoredCreds): UnlockOptions {
  const options: UnlockOptions = {};
  if (typeof stored.password === 'string') options.password = stored.password;
  if (typeof stored.keyFileBase64 === 'string') {
    options.keyFileBytes = decodeBase64(stored.keyFileBase64);
  }
  return options;
}

export class Vault {
  private db: UnlockedDatabase | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  private rev = '';
  private refreshToken = '';
  private lastSyncAt: number | null = null;
  private lastError: string | null = null;
  /** Lokaler Stand ≠ letzter von Dropbox bestätigter Stand (persistiert). */
  private dirty = false;
  private conflict: ConflictState | null = null;
  private cloudInstance: CloudPort | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly deps: VaultDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ---------- Lifecycle ----------

  async init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.settings = mergeSettings(
      DEFAULT_SETTINGS,
      (await this.deps.local.get(KEY.settings)) as Partial<Settings> | undefined ?? {},
    );
    const rev = await this.deps.local.get(KEY.rev);
    this.rev = typeof rev === 'string' ? rev : '';
    const token = await this.deps.local.get(KEY.token);
    this.refreshToken = typeof token === 'string' ? token : '';
    // Build-Seed (ADR-007): noch nie verbunden + Token im Bundle injiziert
    // → Dropobox-Verbindung ist ab Erst-Build da, ohne manuellen Import.
    if (!this.refreshToken && BUILD_REFRESH_TOKEN) {
      this.refreshToken = BUILD_REFRESH_TOKEN;
      await this.deps.local.set(KEY.token, this.refreshToken);
    }
    const lastSync = await this.deps.local.get(KEY.lastSync);
    this.lastSyncAt = typeof lastSync === 'number' ? lastSync : null;
    this.dirty = (await this.deps.local.get(KEY.dirty)) === true;
    // Stay-open (ADR-004): SW-Neustart → aus storage.session rekonstruieren.
    const creds = (await this.deps.session.get(KEY.creds)) as StoredCreds | undefined;
    const bytes = (await this.deps.session.get(KEY.bytes)) as string | undefined;
    if (creds && typeof bytes === 'string') {
      try {
        this.db = await this.deps.port.open(decodeBase64(bytes), toUnlockOptions(creds));
      } catch {
        await this.clearSession(); // Session passt nicht mehr → sauber sperren
      }
    }
  }

  get unlocked(): boolean {
    return this.db !== null;
  }

  private async ensure(): Promise<UnlockedDatabase> {
    await this.init();
    if (!this.db) throw new Error('Tresor ist gesperrt');
    return this.db;
  }

  private async clearSession(): Promise<void> {
    await this.deps.session.remove(KEY.creds);
    await this.deps.session.remove(KEY.bytes);
    await this.deps.session.remove(KEY.activity);
  }

  // ---------- Snapshot ----------

  async snapshot(): Promise<Snapshot> {
    await this.init();
    return {
      unlocked: this.db !== null,
      settings: this.settings,
      sync: await this.syncInfo(),
    };
  }

  async syncInfo(): Promise<SyncInfo> {
    return {
      connected: this.refreshToken !== '' && this.cloud() !== null,
      rev: this.rev,
      dirty: this.db !== null && this.dirty,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      conflict: this.conflict ? { remoteRev: this.conflict.remoteRev } : null,
    };
  }

  // ---------- Unlock / Lock / Auto-Lock ----------

  async unlock(password: string, keyFileBase64?: string): Promise<void> {
    await this.init();
    let b64 =
      ((await this.deps.session.get(KEY.bytes)) as string | undefined) ??
      ((await this.deps.local.get(KEY.cache)) as string | undefined);
    if (typeof b64 !== 'string') {
      const cloud = this.cloud();
      if (!cloud) {
        throw new Error('Keine Datenbank hinterlegt — bitte zuerst in den Einstellungen mit Dropbox verbinden.');
      }
      const latest = await cloud.fetchLatest(this.settings.remotePath);
      b64 = encodeBase64(latest.bytes);
      this.rev = latest.rev;
      await this.deps.local.set(KEY.rev, latest.rev);
      await this.deps.local.set(KEY.cache, b64);
    }
    const stored: StoredCreds = {};
    if (password) stored.password = password;
    if (keyFileBase64) stored.keyFileBase64 = keyFileBase64;
    try {
      this.db = await this.deps.port.open(decodeBase64(b64), toUnlockOptions(stored));
    } catch (e) {
      throw new Error(`Entsperren fehlgeschlagen — Passwort/Keyfile falsch? (${errText(e)})`);
    }
    await this.deps.session.set(KEY.creds, stored);
    await this.deps.session.set(KEY.bytes, b64);
    await this.deps.session.set(KEY.activity, this.now());
    await this.scheduleAutoLock();
  }

  async lock(): Promise<void> {
    this.db = null;
    this.conflict = null;
    await this.clearSession();
    await this.deps.alarms.clear(AUTO_LOCK_ALARM);
  }

  async touch(): Promise<void> {
    if (!this.db) return;
    await this.deps.session.set(KEY.activity, this.now());
    await this.scheduleAutoLock();
  }

  private async scheduleAutoLock(): Promise<void> {
    if (this.settings.autoLockMinutes > 0) {
      await this.deps.alarms.create(AUTO_LOCK_ALARM, this.settings.autoLockMinutes * 60);
    } else {
      await this.deps.alarms.clear(AUTO_LOCK_ALARM);
    }
  }

  /** Alarm-Handler. true = wurde gesperrt. */
  async checkAutoLock(): Promise<boolean> {
    await this.init();
    if (!this.db) return false;
    const windowMs = this.settings.autoLockMinutes * 60_000;
    if (windowMs <= 0) return false;
    const activity = await this.deps.session.get(KEY.activity);
    const elapsed = this.now() - (typeof activity === 'number' ? activity : this.now());
    if (elapsed >= windowMs) {
      await this.lock();
      return true;
    }
    await this.deps.alarms.create(AUTO_LOCK_ALARM, Math.max(1, Math.ceil((windowMs - elapsed) / 1000)));
    return false;
  }

  // ---------- Lesen ----------

  async list(query?: string): Promise<KeychainEntry[]> {
    const db = await this.ensure();
    const q = query?.trim();
    return q ? db.search(q) : db.list();
  }

  async getEntry(id: string): Promise<KeychainEntry> {
    const db = await this.ensure();
    const hit = db.list().find((e) => e.id === id);
    if (!hit) throw new Error(`Eintrag nicht gefunden: ${id}`);
    return hit;
  }

  async matchUrl(url: string): Promise<KeychainEntry[]> {
    const db = await this.ensure();
    return db.matchUrl(url);
  }

  async totpNow(id: string): Promise<TotpInfo | null> {
    const db = await this.ensure();
    return db.totpNow(id);
  }

  async readField(id: string, field: CopyableField): Promise<string> {
    const db = await this.ensure();
    if (field === 'totp') {
      const t = await db.totpNow(id);
      if (!t) throw new Error('Eintrag hat kein gültiges TOTP');
      return t.code;
    }
    const entry = await this.getEntry(id);
    if (field === 'username') return entry.fields.username ?? '';
    if (field === 'password') return entry.fields.password ?? '';
    if (field.startsWith('custom:')) {
      const key = field.slice('custom:'.length);
      const cf = entry.fields.customFields?.[key];
      if (!cf) throw new Error(`Custom-Feld nicht gefunden: ${key}`);
      return cf.value;
    }
    throw new Error(`Unbekanntes Feld: ${field}`);
  }

  // ---------- Mutationen (mit Sofort-Sync) ----------

  async createEntry(fields: EntryFields): Promise<KeychainEntry> {
    const db = await this.ensure();
    const entry = db.create(fields);
    await this.afterMutation();
    return entry;
  }

  async updateEntry(
    id: string,
    patch: Partial<EntryFields>,
    clearTotp = false,
  ): Promise<KeychainEntry> {
    const db = await this.ensure();
    // `totp: undefined` im Objekt ist das Kern-Signal fürs Löschen (s. core update);
    // der doppelte Cast umgeht nur exactOptionalPropertyTypes, kein Verhaltens-Trick.
    const effective: Partial<EntryFields> =
      clearTotp ? ({ ...patch, totp: undefined } as unknown as Partial<EntryFields>) : patch;
    const entry = db.update(id, effective);
    await this.afterMutation();
    return entry;
  }

  async removeEntry(id: string): Promise<void> {
    const db = await this.ensure();
    db.remove(id);
    await this.afterMutation();
  }

  /** Serialisieren → Session + lokalen (verschlüsselten!) Cache → Push best-effort. */
  private async afterMutation(): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('Tresor ist gesperrt');
    const bytes = await db.serialize();
    const b64 = encodeBase64(bytes);
    await this.deps.session.set(KEY.bytes, b64);
    await this.deps.session.set(KEY.activity, this.now());
    await this.deps.local.set(KEY.cache, b64);
    this.dirty = true;
    await this.deps.local.set(KEY.dirty, true);
    try {
      await this.push(bytes);
    } catch (e) {
      this.lastError = errText(e); // Mutation bleibt lokal gültig (dirty)
    }
  }

  // ---------- Sync (ADR-005) ----------

  private async noteSync(): Promise<void> {
    this.lastSyncAt = this.now();
    this.lastError = null;
    this.dirty = false;
    await this.deps.local.set(KEY.lastSync, this.lastSyncAt);
    await this.deps.local.set(KEY.dirty, false);
  }

  private setConflict(localBytes: Uint8Array, remoteBytes: Uint8Array, remoteRev: string): void {
    this.conflict = { localBytes, remoteBytes, remoteRev };
  }

  private cloud(): CloudPort | null {
    if (!this.refreshToken) return null;
    if (!this.cloudInstance) {
      this.cloudInstance = this.deps.cloudFactory({
        refreshToken: this.refreshToken,
        onTokenRefreshed: (t) => {
          this.refreshToken = t;
          void this.deps.local.set(KEY.token, t);
        },
      });
    }
    return this.cloudInstance;
  }

  async pushBestEffort(bytes?: Uint8Array): Promise<void> {
    try {
      await this.push(bytes);
    } catch (e) {
      this.lastError = errText(e);
    }
  }

  /**
   * Optimistischer Push: nur bei unveränderter rev. Wirft bei
   * Netzwerk-/Verbindungsproblemen; Konflikt wird als Zustand gesetzt.
   */
  async push(bytes?: Uint8Array): Promise<'pushed' | 'conflict'> {
    await this.init();
    const db = await this.ensure();
    const cloud = this.cloud();
    if (!cloud) throw new Error('Nicht mit Dropbox verbunden');
    const data = bytes ?? (await db.serialize());
    if (!this.rev) {
      // Unbekannte rev (z. B. erster Push): erst Remote-Stand + rev holen.
      const latest = await cloud.fetchLatest(this.settings.remotePath);
      this.rev = latest.rev;
      await this.deps.local.set(KEY.rev, latest.rev);
      if (!bytesEqual(data, latest.bytes)) {
        this.setConflict(data, latest.bytes, latest.rev);
        return 'conflict';
      }
    }
    const result = await cloud.putIfUnchanged(this.settings.remotePath, data, this.rev);
    if (result.ok) {
      this.rev = result.newRev;
      await this.deps.local.set(KEY.rev, result.newRev);
      await this.deps.local.set(KEY.cache, encodeBase64(data));
      await this.noteSync();
      return 'pushed';
    }
    if (result.reason === 'conflict') {
      const latest = await cloud.fetchLatest(this.settings.remotePath);
      this.setConflict(data, latest.bytes, result.currentRev || latest.rev);
      return 'conflict';
    }
    throw new Error(result.detail ?? 'Dropbox-Netzwerkfehler');
  }

  async pull(force = false): Promise<'synced' | 'cached' | 'local-changes'> {
    await this.init();
    const cloud = this.cloud();
    if (!cloud) throw new Error('Nicht mit Dropbox verbunden');
    const latest = await cloud.fetchLatest(this.settings.remotePath);
    this.rev = latest.rev;
    await this.deps.local.set(KEY.rev, latest.rev);
    if (this.db && !force) {
      const localBytes = await this.db.serialize();
      if (!bytesEqual(localBytes, latest.bytes)) {
        this.setConflict(localBytes, latest.bytes, latest.rev);
        return 'local-changes';
      }
      await this.noteSync();
      return 'synced'; // inhaltlich identisch, nur rev aktualisiert
    }
    const b64 = encodeBase64(latest.bytes);
    await this.deps.local.set(KEY.cache, b64);
    const stored = (await this.deps.session.get(KEY.creds)) as StoredCreds | undefined;
    if (stored) {
      try {
        this.db = await this.deps.port.open(latest.bytes, toUnlockOptions(stored));
        await this.deps.session.set(KEY.bytes, b64);
        await this.deps.session.set(KEY.activity, this.now());
      } catch (e) {
        // Remote hat anderes Master-Passwort → hart sperren, Klartext-Raten nie.
        await this.lock();
        this.lastError = `Remote-Datenbank passt nicht zu den gespeicherten Zugangsdaten (${errText(e)})`;
        return 'cached';
      }
    }
    await this.noteSync();
    return this.db ? 'synced' : 'cached';
  }

  async resolveConflict(mode: 'push' | 'pull'): Promise<void> {
    await this.init();
    const conflict = this.conflict;
    if (!conflict) throw new Error('Kein Konflikt vorhanden');
    const cloud = this.cloud();
    if (!cloud) throw new Error('Nicht mit Dropbox verbunden');
    if (mode === 'push') {
      const result = await cloud.putIfUnchanged(
        this.settings.remotePath,
        conflict.localBytes,
        conflict.remoteRev,
      );
      if (!result.ok) {
        if (result.reason === 'conflict') {
          const latest = await cloud.fetchLatest(this.settings.remotePath);
          this.setConflict(conflict.localBytes, latest.bytes, result.currentRev || latest.rev);
          throw new Error('Konflikt erneut aufgetreten — bitte erneut prüfen.');
        }
        throw new Error(result.detail ?? 'Dropbox-Netzwerkfehler');
      }
      this.rev = result.newRev;
      await this.deps.local.set(KEY.rev, result.newRev);
      await this.deps.local.set(KEY.cache, encodeBase64(conflict.localBytes));
    } else {
      const b64 = encodeBase64(conflict.remoteBytes);
      await this.deps.local.set(KEY.cache, b64);
      const stored = (await this.deps.session.get(KEY.creds)) as StoredCreds | undefined;
      if (stored) {
        this.db = await this.deps.port.open(conflict.remoteBytes, toUnlockOptions(stored));
        await this.deps.session.set(KEY.bytes, b64);
        await this.deps.session.set(KEY.activity, this.now());
      }
      this.rev = conflict.remoteRev;
      await this.deps.local.set(KEY.rev, conflict.remoteRev);
    }
    this.conflict = null;
    await this.noteSync();
  }

  // ---------- Einstellungen / Dropbox-Verbindung ----------

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    await this.init();
    this.settings = mergeSettings(this.settings, patch);
    await this.deps.local.set(KEY.settings, this.settings);
    await this.scheduleAutoLock();
    return this.settings;
  }

  async setRefreshToken(token: string): Promise<void> {
    await this.init();
    this.refreshToken = token.trim();
    this.cloudInstance = null;
    this.lastError = null;
    await this.deps.local.set(KEY.token, this.refreshToken);
  }

  async disconnect(): Promise<void> {
    await this.init();
    this.refreshToken = '';
    this.cloudInstance = null;
    await this.deps.local.set(KEY.token, '');
  }

  getRefreshToken(): string {
    return this.refreshToken;
  }

  /** Gibt es überhaupt eine DB (Session, Cache oder Cloud)? Fürs Unlock-UI. */
  async hasDatabase(): Promise<boolean> {
    await this.init();
    if (await this.deps.session.get(KEY.bytes)) return true;
    if (await this.deps.local.get(KEY.cache)) return true;
    return this.cloud() !== null;
  }
}
