/**
 * Popup-UI (Phase 3, ADR-011) — libadwaita-inspiriert (ADR-010), Preact.
 *
 * Architektur (ADR-011, Deklarativität zuerst):
 *  - Der Background ist die einzige Quelle der Wahrheit (Snapshot via IPC).
 *    Das Popup ist eine Projektion: Views bekommen Daten als Props, nie via
 *    DOM-Lesezugriff.
 *  - Interaktion = RuntimeMessage an den Router; es gibt keinen direkten
 *    DOM-Zweig. Mutations aktualisieren den Snapshot, die View folgt.
 *  - Bedingte Abschnitte stehen als JSX-Blöcke ({x && <Row … />}), nicht in
 *    Helferketten. Nur wirklich wiederverwendbare Bausteine sind Komponenten.
 */
import { createContext, render } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  buildOtpUri,
  parseOtpUri,
  type EntryFields,
  type KeychainEntry,
  type TotpConfig,
} from '@kdbx-keychain/core';
import { encodeBase64 } from '../shared/base64';
import { callBackground } from '../shared/ipc';
import {
  VAULT_SVG,
  KEY_SVG,
  USER_SVG,
  CLOCK_SVG,
  WAND_SVG,
  UP_SVG,
  DOWN_SVG,
  OPEN_SVG,
  EYE_SVG,
  COPY_SVG,
} from './icons';
import type { CopyableField, FillResult, Snapshot, TotpInfo } from '../shared/messages';

type View = 'locked' | 'list' | 'detail' | 'edit';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// ---------- Kontexte (statt Prop-Gewitter) ----------

const NotifyCtx = createContext<(message: string) => void>(() => {});

// ---------- Primitives ----------

/** Kopiert ein Feld über den Background und meldet den Erfolg als Toast. */
function useCopy(): (entryId: string, field: CopyableField) => Promise<void> {
  const notify = useContext(NotifyCtx);
  return async (entryId, field) => {
    const res = await callBackground<{ clearsAt: number | null }>({ type: 'COPY', entryId, field });
    notify(res.clearsAt ? 'Kopiert — wird automatisch gelöscht' : 'Kopiert');
  };
}

/** Inline-SVG (Lucide, stroke=currentColor) — Tinting folgt der CSS-Farbe. */
function Icon({ svg, cls = 'file-ico' }: { svg: string; cls?: string }) {
  return <span class={cls} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Icon-Only-Button; bei `flash` zeigt er nach erfolgreichem Action kurz ✓. */
function IconButton({
  svg,
  title,
  action,
  flash = false,
  cls = 'icon-btn',
}: {
  svg: string;
  title: string;
  action: () => unknown;
  flash?: boolean;
  cls?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class={cls}
      title={title}
      onClick={() => {
        // Fehler übernimmt das Toast-/Banner-Handling der aufrufenden View.
        Promise.resolve(action()).then(() => {
          if (!flash) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 900);
        }, () => {});
      }}
      dangerouslySetInnerHTML={done ? { __html: '✓' } : { __html: svg }}
    />
  );
}

/** Kopier-Button für ein Entry-Feld (✓-Feedback + Toast). */
function CopyButton({ entryId, field, title = 'Kopieren' }: { entryId: string; field: CopyableField; title?: string }) {
  const copy = useCopy();
  return <IconButton svg={COPY_SVG} title={title} flash action={() => copy(entryId, field)} />;
}

/** Öffnet eine URL in neuem Tab. */
function OpenButton({ url, title = 'Website öffnen' }: { url: string; title?: string }) {
  return <IconButton svg={OPEN_SVG} title={title} action={() => chrome.tabs.create({ url })} />;
}

/** Füllt die aktive Seite aus dem Entry und schließt danach das Popup. */
function FillButton({ entryId, title }: { entryId: string; title: string }) {
  const notify = useContext(NotifyCtx);
  return (
    <IconButton
      svg={WAND_SVG}
      title={title}
      action={async () => {
        const res = await callBackground<{ filled: FillResult }>({ type: 'FILL', entryId });
        const { username, password } = res.filled;
        notify(username || password ? 'Ausgefüllt' : 'Keine Login-Felder gefunden');
        window.close();
      }}
    />
  );
}

/** Bannerzeile (Fehler/Warnung). */
function Banner({ kind, children }: { kind: 'danger' | 'warn'; children: ComponentChildren }) {
  return (
    <div class={`banner ${kind}`} {...(kind === 'danger' ? { role: 'alert' } : {})}>
      {children}
    </div>
  );
}

/** Detail-Zeile: Label · Wert (Ellipsis, optional Klick-zum-Kopieren) · Aktionen rechts. */
function Row({
  label,
  value,
  valueClass,
  valueTitle,
  copyable = false,
  onClick,
  actions,
}: {
  label: string;
  value: ComponentChildren;
  valueClass?: string;
  valueTitle?: string;
  copyable?: boolean;
  onClick?: () => void;
  actions?: ComponentChildren;
}) {
  return (
    <div class="row">
      <span class="row-label">{label}</span>
      <span
        class={`row-value${copyable ? ' copyable' : ''}${valueClass ? ` ${valueClass}` : ''}`}
        {...(valueTitle ? { title: valueTitle } : {})}
        onClick={onClick}
      >
        {value}
      </span>
      <span class="row-actions">{actions}</span>
    </div>
  );
}

/** Toast: verschwindet nach 2,2 s von selbst. */
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div class="toast" role="status">
      {message}
    </div>
  );
}

/** TOTP-Codes für Entry-IDs: 1×/s Countdown; bei Ablauf holt der Hook neu. */
function useTotpCodes(ids: string[]): Map<string, TotpInfo> {
  const [totp, setTotp] = useState<Map<string, TotpInfo>>(new Map());
  const latest = useRef(totp);
  const key = ids.join(',');

  useEffect(() => {
    latest.current = totp;
  });

  useEffect(() => {
    if (!key) {
      setTotp(new Map());
      return;
    }
    let cancelled = false;
    const fetchAll = async (): Promise<void> => {
      const next = new Map<string, TotpInfo>();
      await Promise.all(
        key.split(',').map(async (id) => {
          const info = await callBackground<TotpInfo | null>({ type: 'TOTP_NOW', entryId: id });
          if (info) next.set(id, info);
        }),
      );
      if (!cancelled) setTotp(next);
    };
    void fetchAll();
    const timer = window.setInterval(() => {
      let expired = false;
      const ticked = new Map<string, TotpInfo>();
      for (const [id, info] of latest.current) {
        const remaining = info.remainingSeconds - 1;
        if (remaining <= 0) expired = true;
        ticked.set(id, { ...info, remainingSeconds: Math.max(remaining, 0) });
      }
      setTotp(ticked);
      if (expired) void fetchAll();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key]);

  return totp;
}

// ---------- Kopfzeile ----------

function Header({ unlocked, onLock }: { unlocked: boolean; onLock: () => void }) {
  return (
    <header>
      <h1>
        <span class="logo" dangerouslySetInnerHTML={{ __html: KEY_SVG }} /> KDBX Keychain
      </h1>
      <div class="header-actions">
        <span class={`chip ${unlocked ? 'unlocked' : 'locked'}`}>{unlocked ? 'offen' : 'gesperrt'}</span>
        <button type="button" class="icon-btn" title="Sperren" hidden={!unlocked} onClick={onLock}>
          🔒
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Einstellungen"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

// ---------- View: Locked ----------

type Prefill =
  | { status: 'loading' }
  | { status: 'ok'; b64: string; name: string; path?: string }
  | { status: 'error'; error: string };

function LockedView({ snapshot, onUnlocked }: { snapshot: Snapshot | null; onUnlocked: (s: Snapshot) => void }) {
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<{ b64: string; name: string } | null>(null);
  const [prefill, setPrefill] = useState<Prefill>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  // Refs schließen die Race: Enter-zu-schnell wartet aktiv auf den Prefill.
  const prefillDone = useRef<Promise<unknown>>(Promise.resolve());
  const keyRef = useRef<{ b64?: string; error?: string }>({});

  useEffect(() => {
    pwRef.current?.focus();
  }, []);

  // ADR-010: Keyfile vorab über den Native-Messaging-Host ziehen (agenix).
  // Scheitert es, bleibt die manuelle Dateiauswahl der Weg.
  useEffect(() => {
    prefillDone.current = callBackground<{
      b64?: string;
      source?: string;
      name?: string;
      path?: string;
      error?: string;
    }>({ type: 'PREFILL_KEYFILE' })
      .then((res) => {
        if (res.b64) {
          keyRef.current = { b64: res.b64 };
          setPrefill({
            status: 'ok',
            b64: res.b64,
            name: res.name ?? 'export.key',
            ...(res.path ? { path: res.path } : {}),
          });
        } else {
          keyRef.current = { error: res.error };
          setPrefill({ status: 'error', error: res.error ?? 'nicht verfügbar' });
        }
      })
      .catch((e: unknown) => {
        keyRef.current = { error: errorText(e) };
        setPrefill({ status: 'error', error: errorText(e) });
      });
  }, []);

  const unlock = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    let keyFileBase64: string | undefined;
    try {
      if (file) {
        keyFileBase64 = file.b64;
      } else {
        await prefillDone.current;
        if (keyRef.current.b64) keyFileBase64 = keyRef.current.b64;
      }
      onUnlocked(
        await callBackground<Snapshot>({
          type: 'UNLOCK',
          password,
          ...(keyFileBase64 ? { keyFileBase64 } : {}),
        }),
      );
    } catch (e) {
      const msg = errorText(e);
      setError(
        keyFileBase64 === undefined && msg.includes('InvalidKey')
          ? 'Entsperren fehlgeschlagen — Keyfile fehlte (s. Feld unten). ' +
            (keyRef.current.error ? `(native: ${keyRef.current.error}) ` : '') +
            msg
          : 'Entsperren fehlgeschlagen — Passwort/Keyfile falsch? ' + msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = (e: { currentTarget: HTMLInputElement }): void => {
    const picked = e.currentTarget.files?.[0];
    if (!picked) return;
    void picked
      .arrayBuffer()
      .then((buf) => setFile({ b64: encodeBase64(new Uint8Array(buf)), name: picked.name }));
  };

  // Datei-Metadaten kompakt: Tresor + Keyfile mit Icons, nackte Namen.
  const vaultPath = snapshot?.settings.remotePath ?? '';
  const vaultName = vaultPath.split('/').pop() || 'export.kdbx';
  const keyDisplay = file
    ? { name: file.name, cls: 'file-name', title: undefined }
    : prefill.status === 'ok'
      ? { name: prefill.name, cls: 'file-name', title: prefill.path }
      : prefill.status === 'error'
        ? { name: 'nicht verfügbar', cls: 'file-name key-status-err', title: prefill.error }
        : { name: 'keine .key-Datei', cls: 'file-name dim', title: undefined };

  return (
    <div class="card unlock-card">
      {snapshot?.sync && !snapshot.sync.connected && (
        <Banner kind="warn">
          Nicht mit Dropbox verbunden.
          <button type="button" class="btn small" onClick={() => chrome.runtime.openOptionsPage()}>
            Einstellungen öffnen
          </button>
        </Banner>
      )}
      <h2>Tresor entsperren</h2>
      <label class="field">
        Master-Passwort
        <input
          ref={pwRef}
          type="password"
          placeholder="Master-Passwort"
          autocomplete="off"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void unlock();
          }}
        />
      </label>
      <div class="field">
        <div class="file-meta">
          <div class="file-row">
            <Icon svg={VAULT_SVG} />
            <span class="file-name" {...(vaultPath ? { title: vaultPath } : {})}>
              {vaultName}
            </span>
          </div>
          <div class="file-row">
            <Icon svg={KEY_SVG} />
            <span class={keyDisplay.cls} {...(keyDisplay.title ? { title: keyDisplay.title } : {})}>
              {keyDisplay.name}
            </span>
            <button type="button" class="btn small" onClick={() => fileRef.current?.click()}>
              auswählen
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".key,.keyx" class="file-input" onChange={onPickFile} />
        </div>
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      <button type="button" class="btn primary wide" disabled={busy} onClick={() => void unlock()}>
        Entsperren
      </button>
    </div>
  );
}

// ---------- View: Liste ----------

function ListView({
  snapshot,
  query,
  onQuery,
  reload,
  onOpen,
  onNew,
  onSnapshot,
}: {
  snapshot: Snapshot;
  query: string;
  onQuery: (q: string) => void;
  reload: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSnapshot: (s: Snapshot) => void;
}) {
  const [entries, setEntries] = useState<KeychainEntry[]>([]);
  const [matchIds, setMatchIds] = useState<Set<string>>(new Set());
  const notify = useContext(NotifyCtx);
  const sync = snapshot.sync;

  // Liste + Tab-Abgleich (ADR-006-Hinweis): debounced je Query, sofort je Reload.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await callBackground<{ entries: KeychainEntry[] }>({
          type: 'LIST',
          ...(query ? { query } : {}),
        });
        if (cancelled) return;
        setEntries(res.entries);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url) {
            const m = await callBackground<{ entries: KeychainEntry[] }>({ type: 'MATCH_URL', url: tab.url });
            if (!cancelled) setMatchIds(new Set(m.entries.map((x) => x.id)));
            return;
          }
        } catch {
          // Kein Tab-Kontext (z. B. DevTools) — dann ohne Matches.
        }
        if (!cancelled) setMatchIds(new Set());
      } catch (e) {
        if (!cancelled) notify(errorText(e));
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, reload, notify]);

  const totp = useTotpCodes(entries.filter((e) => e.fields.totp).map((e) => e.id));

  const syncStatus = !sync.connected
    ? 'nicht verbunden'
    : sync.conflict
      ? 'Konflikt mit Dropbox'
      : sync.dirty
        ? 'lokal geändert — nicht hochgeladen'
        : sync.rev
          ? `synchron (rev ${sync.rev.slice(0, 8)}…)`
          : 'verbunden';

  const resolve = async (mode: 'push' | 'pull'): Promise<void> => {
    try {
      await callBackground<unknown>({ type: 'CONFLICT_RESOLVE', mode });
      onSnapshot(await callBackground<Snapshot>({ type: 'LOCK_STATE' }));
      notify(mode === 'pull' ? 'Remote-Version übernommen' : 'Lokale Version hochgeladen');
    } catch (e) {
      notify(errorText(e));
    }
  };

  const push = async (): Promise<void> => {
    try {
      const res = await callBackground<{ snapshot: Snapshot }>({ type: 'SYNC_PUSH' });
      onSnapshot(res.snapshot);
      notify(sync.conflict ? 'Konflikt erkannt' : 'Hochgeladen');
    } catch (e) {
      notify(errorText(e));
    }
  };

  const pull = async (): Promise<void> => {
    try {
      const res = await callBackground<{ result: string; snapshot: Snapshot }>({ type: 'SYNC_PULL' });
      onSnapshot(res.snapshot);
      notify(
        res.result === 'local-changes'
          ? 'Konflikt: bitte entscheiden'
          : res.result === 'cached'
            ? 'Remote zwischengespeichert'
            : 'Aktualisiert',
      );
    } catch (e) {
      notify(errorText(e));
    }
  };

  return (
    <>
      <input type="search" placeholder="Suchen…" value={query} onInput={(e) => onQuery(e.currentTarget.value)} />
      <div class="sync-bar">
        <span class={`sync-status ${sync.connected ? '' : 'dim'}`}>⟳ {syncStatus}</span>
        {sync.conflict && (
          <Banner kind="warn">
            <strong>Konflikt: Dropbox hat eine neuere Version.</strong>
            <button type="button" class="btn" onClick={() => void resolve('pull')}>
              Remote übernehmen
            </button>
            <button type="button" class="btn primary" onClick={() => void resolve('push')}>
              Meine Version hochladen
            </button>
          </Banner>
        )}
        {sync.lastError && <Banner kind="danger">{sync.lastError}</Banner>}
        <div class="sync-actions">
          <IconButton svg={UP_SVG} title="Jetzt hochladen" action={push} />
          <IconButton svg={DOWN_SVG} title="Von Dropbox laden" action={pull} />
          <button type="button" class="icon-btn accent" title="Neuer Eintrag" onClick={onNew}>
            +
          </button>
        </div>
      </div>
      <ul class="entry-list">
        {entries.map((entry) => {
          const info = totp.get(entry.id);
          return (
            <EntryCard
              key={entry.id}
              entry={entry}
              matches={matchIds.has(entry.id)}
              {...(info ? { totp: info } : {})}
              onOpen={() => onOpen(entry.id)}
            />
          );
        })}
        {entries.length === 0 && <li class="dim empty">Keine Einträge.</li>}
      </ul>
    </>
  );
}

function EntryCard({
  entry,
  matches,
  totp,
  onOpen,
}: {
  entry: KeychainEntry;
  matches: boolean;
  totp?: TotpInfo;
  onOpen: () => void;
}) {
  const f = entry.fields;
  return (
    <li
      class={`card entry${matches ? ' matches-tab' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onOpen();
      }}
    >
      <div class="entry-head">
        <span class="entry-title">{f.title || '(ohne Titel)'}</span>
        {f.url && <span class="chip dim-chip">{hostOf(f.url)}</span>}
        {matches && <span class="chip ok-chip">✦ diese Seite</span>}
      </div>
      <div class="entry-sub">
        {f.username && <span class="dim">{f.username}</span>}
        {f.totp && totp && (
          <span class="totp-chip" title="TOTP kopieren">
            <code>{totp.code}</code>
            <span class="totp-remaining">{totp.remainingSeconds}s</span>
          </span>
        )}
      </div>
      <div class="entry-actions">
        <CopyButton entryId={entry.id} field="username" title="Benutzername kopieren" />
        <CopyButton entryId={entry.id} field="password" title="Passwort kopieren" />
        {f.totp && <CopyButton entryId={entry.id} field="totp" title="TOTP kopieren" />}
        <FillButton entryId={entry.id} title="Auf dieser Seite ausfüllen" />
        {f.url && <OpenButton url={f.url} />}
      </div>
    </li>
  );
}

// ---------- View: Detail ----------

/** Passwortzeile: maskiert bis zum Klick auf das Auge. */
function PasswordRow({ entryId, password }: { entryId: string; password: string }) {
  const [revealed, setRevealed] = useState(false);
  const copy = useCopy();
  const copyPassword = (): void => void copy(entryId, 'password');
  return (
    <Row
      label="Passwort"
      value={revealed ? password : '••••••••'}
      valueClass={revealed ? 'secret mono' : 'secret masked mono'}
      copyable
      onClick={copyPassword}
      actions={
        <>
          <IconButton svg={EYE_SVG} title="Anzeigen/Verbergen" action={() => setRevealed((v) => !v)} />
          <CopyButton entryId={entryId} field="password" />
        </>
      }
    />
  );
}

function DetailView({
  entryId,
  onBack,
  onEdit,
  onSnapshot,
}: {
  entryId: string;
  onBack: () => void;
  onEdit: () => void;
  onSnapshot: (s: Snapshot) => void;
}) {
  const [entry, setEntry] = useState<KeychainEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notify = useContext(NotifyCtx);
  const copy = useCopy();

  useEffect(() => {
    let cancelled = false;
    void callBackground<{ entry: KeychainEntry }>({ type: 'GET_ENTRY', entryId })
      .then((res) => {
        if (!cancelled) setEntry(res.entry);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const f = entry?.fields;
  const totp = useTotpCodes(f?.totp ? [entryId] : []);
  const info = f?.totp ? totp.get(entryId) : undefined;

  const del = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      const r = await callBackground<{ snapshot: Snapshot }>({ type: 'DELETE_ENTRY', entryId });
      onSnapshot(r.snapshot);
      notify('Eintrag gelöscht (Papierkorb)');
      onBack();
    } catch (e) {
      notify(errorText(e));
    }
  };

  if (!f) {
    return (
      <div class="card detail">
        <button type="button" class="btn link" onClick={onBack}>
          ← Zurück
        </button>
        {error ? <Banner kind="danger">{error}</Banner> : <p class="dim">Lädt…</p>}
      </div>
    );
  }

  const { title, username, password, url, notes, customFields } = f;

  return (
    <div class="card detail">
      <button type="button" class="btn link" onClick={onBack}>
        ← Zurück
      </button>
      <h2>{title || '(ohne Titel)'}</h2>

      {username && (
        <Row
          label="Benutzername"
          value={username}
          valueTitle={username}
          copyable
          onClick={() => void copy(entryId, 'username')}
          actions={<CopyButton entryId={entryId} field="username" />}
        />
      )}
      {password && <PasswordRow entryId={entryId} password={password} />}
      {f.totp && info && (
        <Row
          label="TOTP"
          value={<code class="totp-big">{info.code}</code>}
          copyable
          onClick={() => void copy(entryId, 'totp')}
          actions={
            <>
              <span class="totp-remaining">{info.remainingSeconds}s</span>
              <CopyButton entryId={entryId} field="totp" />
            </>
          }
        />
      )}
      {url && (
        <Row
          label="Website"
          value={hostOf(url)}
          valueTitle={url}
          actions={
            <>
              <OpenButton url={url} />
              <FillButton entryId={entryId} title="Ausfüllen" />
            </>
          }
        />
      )}
      {Object.entries(customFields ?? {}).map(([key, cf]) => (
        <Row
          key={key}
          label={key}
          value={cf.secret ? `${cf.value.slice(0, 2)}••••` : cf.value}
          valueTitle={cf.value}
          copyable
          onClick={() => void copy(entryId, `custom:${key}`)}
          actions={<CopyButton entryId={entryId} field={`custom:${key}`} />}
        />
      ))}
      {notes && <div class="notes">{notes}</div>}

      <hr />
      <div class="detail-actions">
        <button type="button" class="btn" onClick={onEdit}>
          Bearbeiten
        </button>
        <button type="button" class="btn danger" onClick={() => void del()}>
          {confirmDelete ? 'Wirklich löschen?' : 'Löschen'}
        </button>
      </div>
    </div>
  );
}

// ---------- View: Edit / Create ----------

interface FormState {
  title: string;
  username: string;
  password: string;
  url: string;
  totp: string;
  notes: string;
}

const EMPTY_FORM: FormState = { title: '', username: '', password: '', url: '', totp: '', notes: '' };

function EditView({
  editingId,
  onDone,
  onSnapshot,
}: {
  editingId: string | null;
  onDone: () => void;
  onSnapshot: (s: Snapshot) => void;
}) {
  const isEdit = editingId !== null;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [original, setOriginal] = useState<EntryFields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notify = useContext(NotifyCtx);

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    void callBackground<{ entry: KeychainEntry }>({ type: 'GET_ENTRY', entryId: editingId })
      .then((res) => {
        if (cancelled) return;
        const f = res.entry.fields;
        setOriginal(f);
        setForm({
          title: f.title ?? '',
          username: f.username ?? '',
          password: f.password ?? '',
          url: f.url ?? '',
          totp: f.totp ? buildOtpUri(f.totp) : '',
          notes: f.notes ?? '',
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const set =
    (key: keyof FormState) =>
    (e: { currentTarget: { value: string } }): void => {
      const value = e.currentTarget.value;
      setForm((prev) => ({ ...prev, [key]: value }));
    };

  const parseTotpInput = (raw: string): TotpConfig | undefined | 'invalid' => {
    const text = raw.trim();
    if (!text) return undefined;
    const parsed = parseOtpUri(text);
    if (parsed) return parsed;
    if (/^[A-Za-z2-7=\s-]{8,}$/.test(text)) {
      return { secret: text.replace(/[\s-]/g, ''), digits: 6, period: 30, algorithm: 'SHA1' };
    }
    return 'invalid';
  };

  const save = async (): Promise<void> => {
    setError(null);
    if (!form.title.trim()) {
      setError('Titel ist erforderlich.');
      return;
    }
    const totp = parseTotpInput(form.totp);
    if (totp === 'invalid') {
      setError('TOTP-Eingabe ist kein otpauth://-URI oder Base32-Seed.');
      return;
    }
    const patch = {
      title: form.title.trim(),
      ...(form.username ? { username: form.username } : {}),
      ...(form.password ? { password: form.password } : {}),
      ...(form.url ? { url: form.url } : {}),
      ...(form.notes ? { notes: form.notes } : {}),
      ...(totp ? { totp } : {}),
    };
    try {
      if (editingId) {
        const res = await callBackground<{ snapshot: Snapshot }>({
          type: 'UPDATE_ENTRY',
          entryId: editingId,
          patch,
          ...(form.totp.trim() === '' && original?.totp ? { clearTotp: true } : {}),
        });
        onSnapshot(res.snapshot);
      } else {
        const res = await callBackground<{ snapshot: Snapshot }>({
          type: 'CREATE_ENTRY',
          // Formular liefert nur gesetzte Felder; Titel ist oben validiert.
          fields: patch as unknown as EntryFields,
        });
        onSnapshot(res.snapshot);
      }
      notify('Gespeichert');
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (isEdit && !original && !error) {
    return (
      <div class="card edit">
        <button type="button" class="btn link" onClick={onDone}>
          ← Abbrechen
        </button>
        <h2>Eintrag bearbeiten</h2>
        <p class="dim">Lädt…</p>
      </div>
    );
  }

  return (
    <div class="card edit">
      <button type="button" class="btn link" onClick={onDone}>
        ← Abbrechen
      </button>
      <h2>{isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h2>
      <label class="field">
        Titel
        <input type="text" placeholder="Titel *" value={form.title} onInput={set('title')} />
      </label>
      <label class="field">
        Benutzername
        <input type="text" placeholder="Benutzername / E-Mail" value={form.username} onInput={set('username')} />
      </label>
      <label class="field">
        Passwort
        <input
          type="password"
          placeholder="Passwort"
          autocomplete="new-password"
          value={form.password}
          onInput={set('password')}
        />
      </label>
      <label class="field">
        Website
        <input type="url" placeholder="https://…" value={form.url} onInput={set('url')} />
      </label>
      <label class="field">
        TOTP (optional)
        <input
          type="text"
          placeholder="TOTP: otpauth://… oder Base32-Seed"
          value={form.totp}
          onInput={set('totp')}
        />
      </label>
      <label class="field">
        Notizen
        <textarea placeholder="Notizen" rows={3} value={form.notes} onInput={set('notes')} />
      </label>
      {error && <Banner kind="danger">{error}</Banner>}
      <button type="button" class="btn primary wide" onClick={() => void save()}>
        {isEdit ? 'Speichern' : 'Anlegen'}
      </button>
    </div>
  );
}

// ---------- App & Boot ----------

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>('locked');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const notify = useCallback((message: string): void => setToast({ message, key: Date.now() }), []);

  // Boot: aktuellen Vault-Zustand holen, View ableiten.
  useEffect(() => {
    void (async () => {
      try {
        const snap = await callBackground<Snapshot>({ type: 'LOCK_STATE' });
        setSnapshot(snap);
        setView(snap.unlocked ? 'list' : 'locked');
      } catch (e) {
        setBootError(errorText(e));
      }
    })();
  }, []);

  // Background-Snapshot übernehmen; Listen hängen am Reload-Zähler.
  const applySnapshot = (snap: Snapshot): void => {
    setSnapshot(snap);
    setReload((n) => n + 1);
  };

  const showList = (): void => {
    setView('list');
    setSelectedId(null);
    setEditingId(null);
  };

  const lock = async (): Promise<void> => {
    applySnapshot(await callBackground<Snapshot>({ type: 'LOCK' }));
    setView('locked');
  };

  const unlocked = snapshot?.unlocked === true;

  // Die View ergibt sich deklarativ aus dem Zustand — ein gesperrter Tresor
  // überschreibt jede Navigation.
  let body: ComponentChildren;
  if (bootError) {
    body = <Banner kind="danger">{bootError}</Banner>;
  } else if (!unlocked) {
    body = <LockedView snapshot={snapshot} onUnlocked={applySnapshot} />;
  } else if (view === 'detail' && selectedId) {
    body = (
      <DetailView
        entryId={selectedId}
        onBack={showList}
        onEdit={() => {
          setEditingId(selectedId);
          setView('edit');
        }}
        onSnapshot={applySnapshot}
      />
    );
  } else if (view === 'edit') {
    body = <EditView editingId={editingId} onDone={showList} onSnapshot={applySnapshot} />;
  } else {
    body = (
      <ListView
        snapshot={snapshot}
        query={query}
        onQuery={setQuery}
        reload={reload}
        onOpen={(id) => {
          setSelectedId(id);
          setView('detail');
        }}
        onNew={() => {
          setEditingId(null);
          setView('edit');
        }}
        onSnapshot={applySnapshot}
      />
    );
  }

  return (
    <NotifyCtx.Provider value={notify}>
      <Header unlocked={unlocked} onLock={() => void lock()} />
      <main>{body}</main>
      {toast && <Toast key={toast.key} message={toast.message} onDone={() => setToast(null)} />}
    </NotifyCtx.Provider>
  );
}

render(<App />, document.getElementById('app') as HTMLElement);
