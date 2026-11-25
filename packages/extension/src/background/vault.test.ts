/**
 * Vault-Tests — die Kerninvarianten ohne Browser:
 *  - ADR-004: Zugangsdaten NUR in storage.session; SW-Neustart (neue Vault-
 *    Instanz, gleiche Stores) rekonstruiert den Tresor; Lock räumt auf.
 *  - ADR-005: Mutation → sofortiger rev-optimistischer Push; 409 → Konflikt-
 *    Zustand; Auflösung nur explizit (push/pull), nie stilles Overwrite.
 *  - Auto-Lock-Fenster inkl. Rescheduling.
 */
import { describe, expect, it } from 'vitest';
import type {
  CloudPort,
  CloudPutResult,
  DatabasePort,
  EntryFields,
  KeychainEntry,
  UnlockOptions,
  UnlockedDatabase,
} from '@kdbx-keychain/core';
import { encodeBase64 } from '../shared/base64';
import {
  AUTO_LOCK_ALARM,
  Vault,
  type AlarmScheduler,
  type CloudFactory,
  type KVStore,
} from './vault';

const MASTER = 'master-pw';
const K = {
  creds: 'kdbx.creds',
  bytes: 'kdbx.bytes',
  cache: 'kdbx.cache',
  rev: 'kdbx.rev',
  token: 'kdbx.refreshToken',
} as const;

// ---------- Fakes ----------

function memKV(): KVStore & { dump(): Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => {
      map.set(k, v);
    },
    remove: async (k) => {
      map.delete(k);
    },
    dump: () => map,
  };
}

class FakeAlarms implements AlarmScheduler {
  readonly created: Array<{ name: string; delaySeconds: number }> = [];
  readonly cleared: string[] = [];
  async create(name: string, delaySeconds: number): Promise<void> {
    this.created.push({ name, delaySeconds });
  }
  async clear(name: string): Promise<void> {
    this.cleared.push(name);
  }
}

interface FakeDbState {
  seed: string;
  entries: Record<string, EntryFields>;
}

/** In-Memory-UnlockedDatabase mit JSON-Serialisierung (Format wie echtes KDBX behandelbar). */
class FakeDb implements UnlockedDatabase {
  private readonly entries: Map<string, EntryFields>;
  private seq = 0;

  constructor(state: FakeDbState) {
    this.entries = new Map(Object.entries(state.entries));
  }

  static serialize(seed: string, entries: Record<string, EntryFields>): Uint8Array {
    const state: FakeDbState = { seed, entries };
    return new TextEncoder().encode(JSON.stringify(state));
  }

  private static entry(id: string, fields: EntryFields): KeychainEntry {
    return { id, groupId: 'root', fields, createdAt: 0, modifiedAt: 0 };
  }

  list(): KeychainEntry[] {
    return [...this.entries].map(([id, fields]) => FakeDb.entry(id, fields));
  }
  search(q: string): KeychainEntry[] {
    const needle = q.toLowerCase();
    return this.list().filter((e) => (e.fields.title ?? '').toLowerCase().includes(needle));
  }
  matchUrl(url: string): KeychainEntry[] {
    return this.list().filter((e) => !!e.fields.url && url.includes(e.fields.url));
  }
  totp(id: string) {
    return this.list().find((e) => e.id === id)?.fields.totp ?? null;
  }
  async totpNow(id: string) {
    return this.totp(id) ? { code: '654321', remainingSeconds: 17 } : null;
  }
  create(fields: EntryFields, _groupId?: string): KeychainEntry {
    const id = `new${++this.seq}`;
    this.entries.set(id, fields);
    return FakeDb.entry(id, fields);
  }
  update(id: string, patch: Partial<EntryFields>): KeychainEntry {
    const current = this.entries.get(id);
    if (!current) throw new Error(`Eintrag nicht gefunden: ${id}`);
    const next: EntryFields = { ...current, ...patch };
    if (patch.totp === undefined && 'totp' in patch) delete next.totp;
    this.entries.set(id, next);
    return FakeDb.entry(id, next);
  }
  remove(id: string): void {
    if (!this.entries.delete(id)) throw new Error(`Eintrag nicht gefunden: ${id}`);
  }
  async serialize(): Promise<Uint8Array> {
    const state: FakeDbState = { seed: 'state', entries: Object.fromEntries(this.entries) };
    return new TextEncoder().encode(JSON.stringify(state));
  }
}

class FakePort implements DatabasePort {
  constructor(private readonly master: string) {}
  async open(bytes: Uint8Array, credentials: UnlockOptions): Promise<UnlockedDatabase> {
    if (credentials.password !== this.master) throw new Error('InvalidKey');
    if (credentials.keyFileBytes) throw new Error('InvalidKey'); // Fake nutzt nur Passwort
    const state = JSON.parse(new TextDecoder().decode(bytes)) as FakeDbState;
    return new FakeDb(state);
  }
}

class FakeCloud implements CloudPort {
  seq = 10;
  failNext: 'network' | null = null;
  constructor(
    public remoteRev: string,
    public remoteBytes: Uint8Array,
  ) {}
  async fetchLatest(_path: string) {
    return { bytes: this.remoteBytes, rev: this.remoteRev };
  }
  async putIfUnchanged(
    _path: string,
    bytes: Uint8Array,
    expectedRev: string,
  ): Promise<CloudPutResult> {
    if (this.failNext === 'network') {
      this.failNext = null;
      return { ok: false, reason: 'network', detail: 'Netzwerk weg' };
    }
    if (expectedRev !== this.remoteRev) {
      return { ok: false, reason: 'conflict', currentRev: this.remoteRev };
    }
    this.remoteBytes = bytes;
    this.remoteRev = `r${++this.seq}`;
    return { ok: true, newRev: this.remoteRev };
  }
}

// ---------- Fixture ----------

function makeFixture(opts: { cloud?: FakeCloud } = {}) {
  const session = memKV();
  const local = memKV();
  const alarms = new FakeAlarms();
  const cloud = opts.cloud ?? new FakeCloud('r1', FakeDb.serialize('unused', {}));
  const factory: CloudFactory = () => cloud;
  let t = 1_000;
  const deps = { session, local, alarms, port: new FakePort(MASTER), cloudFactory: factory };
  // Refresh-Token vorab setzen, damit der Sync-Pfad mitläuft (Tests ohne
  // Dropbox-Fokus können ihn via disconnect() entfernen).
  void local.set(K.token, 'tok');
  const vault = new Vault({ ...deps, now: () => t });
  return {
    vault,
    session,
    local,
    alarms,
    cloud,
    deps,
    setTime: (ms: number) => {
      t = ms;
    },
  };
}

async function seedCache(
  local: KVStore,
  seed: string,
  entries: Record<string, EntryFields>,
  rev = 'r1',
): Promise<void> {
  await local.set(K.cache, encodeBase64(FakeDb.serialize(seed, entries)));
  await local.set(K.rev, rev);
}

function decodeState(bytes: Uint8Array): FakeDbState {
  return JSON.parse(new TextDecoder().decode(bytes)) as FakeDbState;
}

// ---------- Tests ----------

describe('Vault — Unlock/Lock (ADR-004)', () => {
  it('Entsperren aus Cache legt Zugangsdaten ausschließlich in der Session ab', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);

    expect(f.vault.unlocked).toBe(true);
    const creds = (await f.session.get(K.creds)) as { password?: string } | undefined;
    expect(creds?.password).toBe(MASTER);
    // NIE auf Disk:
    expect(f.local.dump().has(K.creds)).toBe(false);
    expect((await f.local.get('kdbx.password')) ?? null).toBeNull();
  });

  it('Service-Worker-Neustart: neue Vault-Instanz rekonstruiert aus storage.session', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);
    await f.vault.createEntry({ title: 'Bleibt über SW-Neustart' });

    // "Neustart": gleiche Stores, frische Vault-Instanz (In-Memory-DB weg)
    const revived = new Vault({ ...f.deps });
    const snap = await revived.snapshot();
    expect(snap.unlocked).toBe(true);
    const entries = await revived.list();
    expect(entries.map((e) => e.fields.title)).toContain('Bleibt über SW-Neustart');
  });

  it('Lock löscht Session-Zustand komplett', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);
    await f.vault.lock();

    expect(f.vault.unlocked).toBe(false);
    expect(await f.session.get(K.creds)).toBeUndefined();
    expect(await f.session.get(K.bytes)).toBeUndefined();
    expect(f.alarms.cleared).toContain(AUTO_LOCK_ALARM);
  });

  it('falsches Passwort wirft und lässt den Tresor gesperrt', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await expect(f.vault.unlock('falsch')).rejects.toThrow(/Entsperren fehlgeschlagen/);
    expect(f.vault.unlocked).toBe(false);
    expect(await f.session.get(K.creds)).toBeUndefined();
  });

  it('ohne Cache lädt Unlock die DB aus der Cloud und speichert rev + Cache', async () => {
    const cloud = new FakeCloud('rX', FakeDb.serialize('remote-seed', { re: { title: 'Remote Entry' } }));
    const f = makeFixture({ cloud });
    await f.vault.setRefreshToken('tok');
    await f.vault.unlock(MASTER);

    const entries = await f.vault.list();
    expect(entries.map((e) => e.fields.title)).toContain('Remote Entry');
    expect(await f.local.get(K.rev)).toBe('rX');
    expect(typeof (await f.local.get(K.cache))).toBe('string');
  });
});

describe('Vault — Sync (ADR-005)', () => {
  it('Mutation pusht sofort, aktualisiert rev/cache, dirty=false', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);

    await f.vault.createEntry({ title: 'Neu von der Extension' });

    expect(f.cloud.remoteRev).not.toBe('r1'); // gepusht
    const remoteState = decodeState(f.cloud.remoteBytes);
    expect(Object.values(remoteState.entries).some((e) => e.title === 'Neu von der Extension')).toBe(true);
    const snap = await f.vault.snapshot();
    expect(snap.sync.dirty).toBe(false);
    expect(snap.sync.conflict).toBeNull();
    expect(snap.sync.lastSyncAt).not.toBeNull();
  });

  it('409 → Konflikt-Zustand; resolve(pull) übernimmt Remote-Version', async () => {
    const cloud = new FakeCloud('r9', FakeDb.serialize('remote', { re: { title: 'Remote Entry' } }));
    const f = makeFixture({ cloud });
    await seedCache(f.local, 's1', { e1: { title: 'Lokal' } }, 'r1');
    await f.vault.unlock(MASTER);

    await f.vault.createEntry({ title: 'Lokale Änderung' });
    let snap = await f.vault.snapshot();
    expect(snap.sync.conflict?.remoteRev).toBe('r9');

    await f.vault.resolveConflict('pull');
    snap = await f.vault.snapshot();
    expect(snap.sync.conflict).toBeNull();
    expect(snap.sync.rev).toBe('r9');
    const titles = (await f.vault.list()).map((e) => e.fields.title);
    expect(titles).toContain('Remote Entry');
    expect(titles).not.toContain('Lokale Änderung'); // bewusst verworfen
  });

  it('409 → resolve(push) setzt lokale Version durch', async () => {
    const cloud = new FakeCloud('r9', FakeDb.serialize('remote', { re: { title: 'Remote Entry' } }));
    const f = makeFixture({ cloud });
    await seedCache(f.local, 's1', { e1: { title: 'Lokal' } }, 'r1');
    await f.vault.unlock(MASTER);
    await f.vault.createEntry({ title: 'Lokale Änderung' });
    expect((await f.vault.snapshot()).sync.conflict).not.toBeNull();

    await f.vault.resolveConflict('push');
    const snap = await f.vault.snapshot();
    expect(snap.sync.conflict).toBeNull();
    expect(snap.sync.rev).toBe('r11');
    expect(Object.values(decodeState(f.cloud.remoteBytes).entries).some((e) => e.title === 'Lokale Änderung')).toBe(true);
  });

  it('Netzwerkfehler beim Push bleibt lokal (dirty) und landet nicht remote', async () => {
    const f = makeFixture();
    f.cloud.failNext = 'network';
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);

    await f.vault.createEntry({ title: 'Nur lokal' });
    const snap = await f.vault.snapshot();
    expect(snap.sync.dirty).toBe(true);
    expect(snap.sync.lastError).toContain('Netzwerk weg');
    expect(f.cloud.remoteRev).toBe('r1');
    expect(Object.values(decodeState(f.cloud.remoteBytes).entries)).toHaveLength(0);
  });

  it('pull ohne force bewahrt lokale Änderungen (Konflikt-Dialog), force übernimmt', async () => {
    const cloud = new FakeCloud('r9', FakeDb.serialize('remote', { re: { title: 'Remote Entry' } }));
    const f = makeFixture({ cloud });
    await seedCache(f.local, 's1', { e1: { title: 'Lokal' } }, 'r1');
    await f.vault.unlock(MASTER);

    const result = await f.vault.pull();
    expect(result).toBe('local-changes');
    expect((await f.vault.snapshot()).sync.conflict).not.toBeNull();

    const forced = await f.vault.pull(true);
    expect(forced).toBe('synced');
    const titles = (await f.vault.list()).map((e) => e.fields.title);
    expect(titles).toContain('Remote Entry');
    expect(titles).not.toContain('Lokal');
  });

  it('ohne Token ist der Sync getrennt und push wirft', async () => {
    const f = makeFixture();
    await f.vault.disconnect();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);
    expect((await f.vault.snapshot()).sync.connected).toBe(false);
    await expect(f.vault.push()).rejects.toThrow(/verbunden/i);
  });
});

describe('Vault — Auto-Lock (ADR-004)', () => {
  it('sperrt nach Ablauf des Fensters, davor nicht (mit Rescheduling)', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    f.setTime(1_000);
    await f.vault.unlock(MASTER); // activity = 1000, Fenster 15 min

    f.setTime(1_000 + 14 * 60_000);
    expect(await f.vault.checkAutoLock()).toBe(false);
    expect(f.vault.unlocked).toBe(true);

    f.setTime(1_000 + 15 * 60_000);
    expect(await f.vault.checkAutoLock()).toBe(true);
    expect(f.vault.unlocked).toBe(false);
    expect(await f.session.get(K.creds)).toBeUndefined();
  });

  it('Auto-Lock 0 = nie; touch schiebt das Fenster hinaus', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' } });
    await f.vault.unlock(MASTER);
    await f.vault.setSettings({ autoLockMinutes: 0 });
    expect(f.alarms.cleared).toContain(AUTO_LOCK_ALARM);

    f.setTime(1_000 + 60 * 60_000); // 1 Stunde später
    expect(await f.vault.checkAutoLock()).toBe(false);
    expect(f.vault.unlocked).toBe(true);
  });
});

describe('Vault — Felder & CRUD', () => {
  it('readField: username/password/totp/custom', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', {
      e1: {
        title: 'Demo',
        username: 'jannis',
        password: 'hunter2',
        customFields: { 'API Key': { value: 'sk-123', secret: true } },
        totp: { secret: 'GEZDGNBVGY3TQOJQ', digits: 6, period: 30, algorithm: 'SHA1' },
      },
    });
    await f.vault.unlock(MASTER);

    expect(await f.vault.readField('e1', 'username')).toBe('jannis');
    expect(await f.vault.readField('e1', 'password')).toBe('hunter2');
    expect(await f.vault.readField('e1', 'totp')).toBe('654321');
    expect(await f.vault.readField('e1', 'custom:API Key')).toBe('sk-123');
    await expect(f.vault.readField('e1', 'custom:fehlend')).rejects.toThrow(/Custom-Feld/);
    await expect(f.vault.readField('nope', 'password')).rejects.toThrow(/nicht gefunden/);
  });

  it('remove entfernt den Eintrag (und pusht)', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', { e1: { title: 'Demo' }, e2: { title: 'Zwei' } });
    await f.vault.unlock(MASTER);
    await f.vault.removeEntry('e1');
    const titles = (await f.vault.list()).map((e) => e.fields.title);
    expect(titles).toEqual(['Zwei']);
    expect(Object.values(decodeState(f.cloud.remoteBytes).entries).map((e) => e.title)).toEqual(['Zwei']);
  });

  it('updateEntry mit clearTotp löscht das TOTP-Feld', async () => {
    const f = makeFixture();
    await seedCache(f.local, 's1', {
      e1: { title: 'Demo', totp: { secret: 'GEZDGNBVGY3TQOJQ', digits: 6, period: 30, algorithm: 'SHA1' } },
    });
    await f.vault.unlock(MASTER);
    expect(await f.vault.totpNow('e1')).not.toBeNull();
    await f.vault.updateEntry('e1', { title: 'Demo' }, true);
    expect(await f.vault.totpNow('e1')).toBeNull();
  });
});
