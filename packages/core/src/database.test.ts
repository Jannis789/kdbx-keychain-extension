import { describe, expect, it } from 'vitest';
import {
  createEmptyDatabase,
  createKdbxDatabasePort,
  type UnlockedDatabase,
} from './index';

const MASTER = 'test-master-pw';
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC-6238-Secret

async function makeDb(): Promise<UnlockedDatabase> {
  const db = await createEmptyDatabase({ password: MASTER });
  db.create({
    title: 'Demo',
    username: 'u1',
    password: 'p1',
    url: 'https://demo.example.com/login',
    totp: { secret: TOTP_SECRET, digits: 6, period: 30, algorithm: 'SHA1' },
    customFields: {
      API: { value: 'geheim-x', secret: true },
      Notiz: { value: 'offen', secret: false },
    },
  });
  db.create({ title: 'Anderes', username: 'u2', password: 'p2', url: 'https://other.org' });
  return db;
}

describe('KdbxDatabase (Roundtrip)', () => {
  it('create → serialize → open zeigt alle Felder', async () => {
    const db = await makeDb();
    const bytes = await db.serialize();
    const db2 = await createKdbxDatabasePort().open(bytes, { password: MASTER });

    const hits = db2.search('demo');
    expect(hits).toHaveLength(1);
    const entry = hits[0]!;
    expect(entry.fields.title).toBe('Demo');
    expect(entry.fields.username).toBe('u1');
    expect(entry.fields.password).toBe('p1');
    expect(entry.fields.totp?.secret).toBe(TOTP_SECRET);
    expect(entry.fields.customFields?.API).toEqual({ value: 'geheim-x', secret: true });
    expect(entry.fields.customFields?.Notiz).toEqual({ value: 'offen', secret: false });
    expect(entry.fields.customFields?.UrlShorter).toBeUndefined();
  });

  it('falsches Master-Passwort wirft', async () => {
    const bytes = await (await makeDb()).serialize();
    await expect(
      createKdbxDatabasePort().open(bytes, { password: 'falsch' }),
    ).rejects.toThrow();
  });

  it('update ändert auch geschützte Felder', async () => {
    const db = await makeDb();
    const [entry] = db.search('Demo');
    db.update(entry!.id, { password: 'p1-neu', url: 'https://new.example.com' });
    const db2 = await createKdbxDatabasePort().open(await db.serialize(), {
      password: MASTER,
    });
    const updated = db2.search('Demo')[0]!;
    expect(updated.fields.password).toBe('p1-neu');
    expect(updated.fields.url).toBe('https://new.example.com');
    // Unberührte Felder bleiben:
    expect(updated.fields.username).toBe('u1');
    expect(updated.fields.customFields?.API).toEqual({ value: 'geheim-x', secret: true });
  });

  it('update mit customFields ersetzt den Satz komplett', async () => {
    const db = await makeDb();
    const [entry] = db.search('Demo');
    db.update(entry!.id, { customFields: { Neu: { value: 'x', secret: false } } });
    const db2 = await createKdbxDatabasePort().open(await db.serialize(), {
      password: MASTER,
    });
    const custom = db2.search('Demo')[0]!.fields.customFields;
    expect(custom?.Neu).toEqual({ value: 'x', secret: false });
    expect(custom?.API).toBeUndefined();
  });

  it('remove entfernt dauerhaft (auch nach Re-Open)', async () => {
    const db = await makeDb();
    const [entry] = db.search('Anderes');
    db.remove(entry!.id);
    expect(db.search('Anderes')).toHaveLength(0);
    const db2 = await createKdbxDatabasePort().open(await db.serialize(), {
      password: MASTER,
    });
    expect(db2.list()).toHaveLength(1);
  });

  it('matchUrl über registrable Domain', async () => {
    const db = await makeDb();
    expect(db.matchUrl('https://demo.example.com/anderer-pfad')).toHaveLength(1);
    expect(db.matchUrl('https://www.demo.example.com')).toHaveLength(1);
    expect(db.matchUrl('https://demo.example.org')).toHaveLength(0);
    expect(db.matchUrl('https://other.org')).toHaveLength(1);
  });

  it('totpNow erzeugt gültigen Code mit Restlaufzeit', async () => {
    const db = await makeDb();
    const [entry] = db.search('Demo');
    const t = await db.totpNow(entry!.id);
    expect(t?.code).toMatch(/^\d{6}$/);
    expect(t!.remainingSeconds).toBeGreaterThanOrEqual(1);
    expect(t!.remainingSeconds).toBeLessThanOrEqual(30);
    expect(await db.totpNow('unbekannt')).toBeNull();
  });

  it('Keyfile-Support: ohne .key-Datei nicht öffnbar, mit schon', async () => {
    const keyFile = Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    const db = await createEmptyDatabase({ password: MASTER, keyFileBytes: keyFile });
    db.create({ title: 'kf-entry', username: 'u' });
    const bytes = await db.serialize();
    const port = createKdbxDatabasePort();

    await expect(port.open(bytes, { password: MASTER })).rejects.toThrow();
    const db2 = await port.open(bytes, { password: MASTER, keyFileBytes: keyFile });
    expect(db2.list().map((e) => e.fields.title)).toEqual(['kf-entry']);
  });
});

// Cross-Check gegen die echte (pykeepass-erzeugte) Test-DB aus Phase 0 —
// stellt sicher, dass kdbxweb fremde KDBX4-Writer korrekt liest.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const testPath = env?.KDBX_TEST_PATH;
const testPw = env?.KDBX_TEST_PASSWORD;

describe.skipIf(!testPath || !testPw)('Integration: pykeepass-erzeugte Test-DB', () => {
  it('liest Einträge, modernes und Legacy-TOTP', async () => {
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(testPath!));
    const db = await createKdbxDatabasePort().open(bytes, { password: testPw! });

    const titles = db.list().map((e) => e.fields.title);
    expect(titles).toContain('Demo Wiki');
    expect(titles).toContain('Legacy TOTP Style');
    expect(titles).toContain('Custom Fields Demo');

    const legacy = db.list().find((e) => e.fields.title === 'Legacy TOTP Style');
    expect(legacy?.fields.totp?.digits).toBe(6);
    expect(legacy?.fields.totp?.period).toBe(30);

    const demo = db.list().find((e) => e.fields.title === 'Demo Wiki');
    const code = await db.totpNow(demo!.id);
    expect(code?.code).toMatch(/^\d{6}$/);

    // Protected Custom Field liest sich sauber:
    const custom = db.list().find((e) => e.fields.title === 'Custom Fields Demo');
    expect(custom?.fields.customFields?.['Abteilung']).toEqual({
      value: 'IT',
      secret: false,
    });
    expect(custom?.fields.customFields?.['API-Key']).toEqual({
      value: 'abcd1234-nicht-echt',
      secret: true,
    });
  });
});
