/**
 * KdbxDatabase: Implementierung von `DatabasePort`/`UnlockedDatabase` auf Basis
 * von kdbxweb (ADR-003).
 *
 * Adapter-Pattern: Domänen-Typen aus `../types` sind die einzige Schnittstelle
 * nach außen; kdbxweb-Typen bleiben hier. Austauschbarkeit (z. B. später
 * keepass-rs für ein CLI) ist damit gesichert, ohne Extension/UI anzufassen.
 *
 * Der kdbxweb-Import wird bewusst auf ein strukturiertes Minimal-Typbild
 * (`KdbxwebNamespace`) gegossen — so hängt core nicht an Versions-Details der
 * Bibliothek, und fehlende Paket-Typen sind kein Problem.
 */
import { argon2d, argon2id } from 'hash-wasm';
import * as kdbxwebModule from 'kdbxweb';
import { buildOtpUri, generateTotp, parseLegacyTotp, parseOtpUri } from '../totp';
import { sameSite } from '../url-matching';
import type {
  CustomField,
  DatabasePort,
  EntryFields,
  KeychainEntry,
  TotpConfig,
  UnlockOptions,
  UnlockedDatabase,
} from '../types';

// ---------- strukturierte kdbxweb-Typbilder ----------

interface UuidLike {
  id?: string;
  bytes?: Uint8Array;
}

interface ProtectedLike {
  getText(): string;
}

interface EntryFieldsLike {
  keys(): IterableIterator<string>;
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  delete(key: string): boolean;
}

interface TimesLike {
  creationTime?: Date | null;
  lastModificationTime?: Date | null;
  touch?(): void;
}

interface EntryLike {
  uuid: UuidLike;
  fields: EntryFieldsLike;
  times: TimesLike;
  tags?: string[];
}

interface PujsArray<T> {
  push(value: T): unknown;
  remove(value: T): unknown;
  length: number;
  [Symbol.iterator](): Iterator<T>;
}

interface GroupLike {
  uuid: UuidLike;
  name: string;
  groups: PujsArray<GroupLike>;
  entries: PujsArray<EntryLike>;
}

interface KdbxLike {
  meta: { recycleBinEnabled?: boolean; recycleBinUuid?: UuidLike };
  getDefaultGroup(): GroupLike;
  createEntry(group: GroupLike): EntryLike;
  /** Papierkorb falls aktiv, sonst Hard-Delete (+ deletedObjects intern). */
  remove(object: EntryLike | GroupLike): void;
  save(credentials: unknown): Promise<ArrayBuffer>;
  header?: { setKdf?(id: unknown): void };
}

interface KdbxwebNamespace {
  Kdbx: {
    create(credentials: unknown): KdbxLike;
    load(bytes: ArrayBuffer, credentials: unknown): Promise<KdbxLike>;
  };
  Credentials: new (
    password: ProtectedLike | null,
    keyFileBytes: ArrayBuffer | null,
  ) => { ready?: Promise<unknown> };
  ProtectedValue: { fromString(value: string): ProtectedLike };
  CryptoEngine?: { setArgon2Impl?(impl: Argon2Impl): void };
  Consts?: { KdfId?: { Aes?: unknown } };
}

/** Signatur der Argon2-Hook von kdbxweb (Ergebnis muss ArrayBuffer sein). */
type Argon2Impl = (
  password: ArrayBuffer,
  salt: ArrayBuffer,
  memory: number,
  iterations: number,
  length: number,
  parallelism: number,
  type: number,
  version?: number,
) => Promise<ArrayBuffer>;

const mod = kdbxwebModule as unknown as { default?: unknown };
const ns = (mod.default ?? kdbxwebModule) as unknown as KdbxwebNamespace;

// Argon2 über hash-wasm liefern (reines WASM, identisch in Node-Tests und
// Browser-Bundle — ADR-003). kdbxweb ruft die Hook mit Argon2-Typ 0 = Argon2d,
// 2 = Argon2id auf; memory ist in KiB.
(ns.CryptoEngine ??= {}).setArgon2Impl?.(
  async (password, salt, memory, iterations, length, parallelism, type) => {
    const options = {
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      iterations,
      parallelism,
      memorySize: memory,
      hashLength: length,
      outputType: 'binary',
    } as const;
    const hash = type === 0 ? await argon2d(options) : await argon2id(options);
    return hash.buffer.slice(
      hash.byteOffset,
      hash.byteOffset + hash.byteLength,
    ) as ArrayBuffer;
  },
);

// ---------- Helpers ----------

function makeCredentials(options: UnlockOptions): { ready?: Promise<unknown> } {
  // kdbxweb 2.x: Passwort muss ProtectedValue sein, Keyfile roher ArrayBuffer.
  const password = options.password
    ? ns.ProtectedValue.fromString(options.password)
    : null;
  const keyFile = options.keyFileBytes ? toArrayBuffer(options.keyFileBytes) : null;
  return new ns.Credentials(password, keyFile);
}

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Title',
  'UserName',
  'Password',
  'URL',
  'Notes',
  'otp',
  'totp',
  'TOTP Seed',
  'TOTP Settings',
]);

function toHex(uuid: UuidLike): string {
  if (typeof uuid.id === 'string' && uuid.id.length > 0) return uuid.id;
  if (uuid.bytes) {
    return Array.from(uuid.bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('kdbxweb-UUID weder als id noch als bytes lesbar');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function fieldKeys(fields: EntryFieldsLike): string[] {
  return Array.from(fields.keys());
}

// ---------- KdbxDatabase ----------

export class KdbxDatabase implements UnlockedDatabase {
  private readonly byId = new Map<string, EntryLike>();
  private readonly groupOf = new Map<string, GroupLike>();
  private readonly binHex: string | undefined;

  constructor(
    private readonly db: KdbxLike,
    private readonly credentials: unknown,
  ) {
    const binUuid = this.db.meta.recycleBinUuid;
    this.binHex = this.db.meta.recycleBinEnabled && binUuid ? toHex(binUuid) : undefined;
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byId.clear();
    this.groupOf.clear();
    const walk = (group: GroupLike): void => {
      if (this.binHex && toHex(group.uuid) === this.binHex) return; // Papierkorb ausblenden
      for (const entry of group.entries) {
        const id = toHex(entry.uuid);
        this.byId.set(id, entry);
        this.groupOf.set(id, group);
      }
      for (const child of group.groups) walk(child);
    };
    walk(this.db.getDefaultGroup());
  }

  private root(): GroupLike {
    return this.db.getDefaultGroup();
  }

  private findGroup(start: GroupLike, id: string): GroupLike | null {
    if (toHex(start.uuid) === id) return start;
    for (const child of start.groups) {
      const hit = this.findGroup(child, id);
      if (hit) return hit;
    }
    return null;
  }

  private text(value: unknown): string | undefined {
    if (value == null) return undefined;
    const raw =
      typeof value === 'string' ? value : (value as ProtectedLike)?.getText?.();
    if (typeof raw !== 'string' || raw === '') return undefined;
    return raw;
  }

  private isProtected(value: unknown): boolean {
    return (
      value != null &&
      typeof value === 'object' &&
      typeof (value as ProtectedLike).getText === 'function'
    );
  }

  private mapEntry(entry: EntryLike, group: GroupLike): KeychainEntry {
    const customFields: Record<string, CustomField> = {};
    for (const key of fieldKeys(entry.fields)) {
      if (RESERVED_KEYS.has(key)) continue;
      const raw = entry.fields.get(key);
      customFields[key] = { value: this.text(raw) ?? '', secret: this.isProtected(raw) };
    }
    const username = this.text(entry.fields.get('UserName'));
    const password = this.text(entry.fields.get('Password'));
    const url = this.text(entry.fields.get('URL'));
    const notes = this.text(entry.fields.get('Notes'));
    const totp = this.extractTotp(entry);
    const tags = Array.isArray(entry.tags) && entry.tags.length > 0 ? [...entry.tags] : undefined;
    return {
      id: toHex(entry.uuid),
      groupId: toHex(group.uuid),
      fields: {
        title: this.text(entry.fields.get('Title')) ?? '',
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(totp !== null ? { totp } : {}),
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        ...(tags !== undefined ? { tags } : {}),
      },
      createdAt: entry.times?.creationTime?.getTime() ?? Date.now(),
      modifiedAt: entry.times?.lastModificationTime?.getTime() ?? Date.now(),
    };
  }

  private extractTotp(entry: EntryLike): TotpConfig | null {
    const otpRaw = this.text(entry.fields.get('otp'));
    if (otpRaw) {
      const parsed = parseOtpUri(otpRaw);
      if (parsed) return parsed;
    }
    const seed = this.text(entry.fields.get('TOTP Seed'));
    if (seed) {
      return parseLegacyTotp(seed, this.text(entry.fields.get('TOTP Settings')));
    }
    return null;
  }

  private touch(entry: EntryLike): void {
    try {
      entry.times?.touch?.();
    } catch {
      /* optional */
    }
  }

  private applyCustomFields(
    fields: EntryFieldsLike,
    customFields: Record<string, CustomField>,
  ): void {
    for (const key of fieldKeys(fields)) {
      if (!RESERVED_KEYS.has(key)) fields.delete(key);
    }
    for (const [key, field] of Object.entries(customFields)) {
      fields.set(key, field.secret ? ns.ProtectedValue.fromString(field.value) : field.value);
    }
  }

  list(): KeychainEntry[] {
    const out: KeychainEntry[] = [];
    for (const [id, entry] of this.byId) {
      const group = this.groupOf.get(id);
      if (group) out.push(this.mapEntry(entry, group));
    }
    return out;
  }

  search(query: string): KeychainEntry[] {
    const q = query.trim().toLowerCase();
    const all = this.list();
    if (!q) return all;
    return all.filter((e) => {
      const f = e.fields;
      const haystack = [
        f.title,
        f.username,
        f.url,
        f.notes,
        ...(f.tags ?? []),
        ...Object.keys(f.customFields ?? {}),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  matchUrl(url: string): KeychainEntry[] {
    return this.list().filter((e) => !!e.fields.url && sameSite(e.fields.url, url));
  }

  totp(id: string): TotpConfig | null {
    const entry = this.byId.get(id);
    return entry ? this.extractTotp(entry) : null;
  }

  async totpNow(id: string): Promise<{ code: string; remainingSeconds: number } | null> {
    const config = this.totp(id);
    return config ? generateTotp(config) : null;
  }

  create(fields: EntryFields, groupId?: string): KeychainEntry {
    const group = groupId
      ? (this.findGroup(this.root(), groupId) ??
        (() => {
          throw new Error(`Gruppe nicht gefunden: ${groupId}`);
        })())
      : this.root();
    const entry = this.db.createEntry(group);
    this.applyFields(entry, fields);
    const mapped = this.mapEntry(entry, group);
    this.byId.set(mapped.id, entry);
    this.groupOf.set(mapped.id, group);
    return mapped;
  }

  private applyFields(entry: EntryLike, fields: EntryFields): void {
    const F = entry.fields;
    F.set('Title', fields.title);
    if (fields.username !== undefined) F.set('UserName', fields.username);
    if (fields.password !== undefined) {
      F.set('Password', ns.ProtectedValue.fromString(fields.password));
    }
    if (fields.url !== undefined) F.set('URL', fields.url);
    if (fields.notes !== undefined) F.set('Notes', fields.notes);
    if (fields.totp) {
      F.set('otp', ns.ProtectedValue.fromString(buildOtpUri(fields.totp, fields.title)));
      F.delete('TOTP Seed');
      F.delete('TOTP Settings');
    }
    if (fields.customFields) this.applyCustomFields(F, fields.customFields);
    if (fields.tags) entry.tags = [...fields.tags];
    this.touch(entry);
  }

  update(id: string, patch: Partial<EntryFields>): KeychainEntry {
    const entry = this.byId.get(id);
    const group = this.groupOf.get(id);
    if (!entry || !group) throw new Error(`Eintrag nicht gefunden: ${id}`);
    const F = entry.fields;
    if (patch.title !== undefined) F.set('Title', patch.title);
    if (patch.username !== undefined) F.set('UserName', patch.username);
    if (patch.password !== undefined) {
      F.set('Password', ns.ProtectedValue.fromString(patch.password));
    }
    if (patch.url !== undefined) F.set('URL', patch.url);
    if (patch.notes !== undefined) F.set('Notes', patch.notes);
    // Bewusst `'totp' in patch`: JSON-IPC (chrome.runtime) verwirft undefined-Keys,
    // das Löschen läuft daher über ein explizit vorhandenes, leeres Feld.
    if ('totp' in patch) {
      if (patch.totp) {
        F.set('otp', ns.ProtectedValue.fromString(buildOtpUri(patch.totp, patch.title ?? '')));
      } else {
        F.delete('otp');
      }
      F.delete('TOTP Seed');
      F.delete('TOTP Settings');
    }
    if (patch.customFields) this.applyCustomFields(F, patch.customFields);
    if (patch.tags) entry.tags = [...patch.tags];
    this.touch(entry);
    return this.mapEntry(entry, group);
  }

  remove(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`Eintrag nicht gefunden: ${id}`);
    // kdbxweb: schiebt in den Papierkorb, falls aktiv — sonst Hard-Delete inkl.
    // deletedObjects-Eintrag (alles intern in db.remove).
    this.db.remove(entry);
    this.byId.delete(id);
    this.groupOf.delete(id);
  }

  async serialize(): Promise<Uint8Array> {
    const buffer = await this.db.save(this.credentials);
    return new Uint8Array(buffer);
  }
}

// ---------- Port / Fabriken ----------

export class KdbxDatabasePort implements DatabasePort {
  async open(bytes: Uint8Array, credentials: UnlockOptions): Promise<UnlockedDatabase> {
    const creds = makeCredentials(credentials);
    await creds.ready;
    const db = await ns.Kdbx.load(toArrayBuffer(bytes), creds);
    return new KdbxDatabase(db, creds);
  }
}

export function createKdbxDatabasePort(): DatabasePort {
  return new KdbxDatabasePort();
}

/** Neue, leere Datenbank erzeugen (Extension: „Neue KDBX anlegen“). */
export async function createEmptyDatabase(options: UnlockOptions = {}): Promise<UnlockedDatabase> {
  const creds = makeCredentials(options);
  await creds.ready;
  const db = ns.Kdbx.create(creds);
  // Fixtures/Tests schnell halten: AES statt Argon2 als KDF, wenn die API es hergibt.
  try {
    db.header?.setKdf?.(ns.Consts?.KdfId?.Aes);
  } catch {
    /* Argon2-Default behalten */
  }
  return new KdbxDatabase(db, creds);
}
