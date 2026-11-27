/**
 * Popup-UI (Phase 3) — libadwaita-inspiriert (ADR-010).
 * Views: Locked → Liste → Detail → Edit/Create. Sämtliche Daten kommen
 * über den Message-Router aus dem Background; hier liegt keine Logik.
 */
import { buildOtpUri, parseOtpUri, type EntryFields, type KeychainEntry, type TotpConfig } from '@kdbx-keychain/core';
import { encodeBase64 } from '../shared/base64';
import { callBackground } from '../shared/ipc';
import { VAULT_SVG, KEY_SVG, USER_SVG, CLOCK_SVG, WAND_SVG, UP_SVG, DOWN_SVG, OPEN_SVG, EYE_SVG, COPY_SVG } from './icons';
import type { CopyableField, FillResult, Snapshot, TotpInfo } from '../shared/messages';

type View = 'locked' | 'list' | 'detail' | 'edit';

interface AppState {
  snapshot: Snapshot | null;
  view: View;
  query: string;
  selectedId: string | null;
  editingId: string | null; // null = neu
  entries: KeychainEntry[];
  matchIds: Set<string>;
  totp: Map<string, TotpInfo>;
}

const state: AppState = {
  snapshot: null,
  view: 'locked',
  query: '',
  selectedId: null,
  editingId: null,
  entries: [],
  matchIds: new Set(),
  totp: new Map(),
};

const viewEl = document.getElementById('view') as HTMLElement;
const lockBtn = document.getElementById('btn-lock') as HTMLButtonElement;
const optionsBtn = document.getElementById('btn-options') as HTMLButtonElement;
const toastEl = document.getElementById('toast') as HTMLElement;

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

// ---------- Mini-DOM-Helfer ----------

function h(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function button(text: string, cls: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button' }, text) as HTMLButtonElement;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Inline-SVG-Icon (Lucide, stroke=currentColor) als span. */
function icon(svg: string, cls = 'file-ico'): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = svg;
  return span;
}

/** Icon-Only-Button mit Lucide-SVG statt Emoji-Glyph (font-unabhängig). */
function iconButton(svg: string, onClick: () => void, title: string): HTMLButtonElement {
  const b = h('button', { class: 'icon-btn', type: 'button', title }) as HTMLButtonElement;
  b.innerHTML = svg;
  b.addEventListener('click', onClick);
  return b;
}

function flash(btn: HTMLButtonElement, done = '✓'): void {
  const original = btn.innerHTML;
  btn.innerHTML = done;
  btn.classList.add('flash');
  window.setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('flash');
  }, 900);
}

function errorBox(message: string): HTMLElement {
  return h('div', { class: 'banner danger', role: 'alert' }, message);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function copyField(
  entryId: string,
  field: CopyableField,
  btn?: HTMLButtonElement | null,
): Promise<void> {
  const res = await callBackground<{ clearsAt: number | null }>({
    type: 'COPY',
    entryId,
    field,
  });
  if (btn) flash(btn);
  toast(res.clearsAt ? 'Kopiert — wird automatisch gelöscht' : 'Kopiert');
}

// ---------- TOTP-Ticker ----------

let ticker: number | undefined;

function stopTicker(): void {
  window.clearInterval(ticker);
  ticker = undefined;
}

function startTicker(onZero: () => void): void {
  stopTicker();
  ticker = window.setInterval(() => {
    let expired = false;
    for (const [id, info] of state.totp) {
      info.remainingSeconds -= 1;
      if (info.remainingSeconds <= 0) expired = true;
      else {
        const el = document.querySelector(`[data-totp-remaining="${id}"]`);
        if (el) el.textContent = `${info.remainingSeconds}s`;
        const codeEl = document.querySelector(`[data-totp-code="${id}"]`);
        if (codeEl) codeEl.textContent = info.code;
      }
    }
    if (expired) onZero();
  }, 1000);
}

async function refreshTotp(entries: KeychainEntry[]): Promise<void> {
  const withTotp = entries.filter((e) => e.fields.totp);
  await Promise.all(
    withTotp.map(async (e) => {
      const info = await callBackground<TotpInfo | null>({ type: 'TOTP_NOW', entryId: e.id });
      if (info) state.totp.set(e.id, info);
      else state.totp.delete(e.id);
    }),
  );
}

// ---------- Kopfzeile ----------

function renderHeader(): void {
  const chip = document.getElementById('lock-state');
  const unlocked = state.snapshot?.unlocked === true;
  lockBtn.hidden = !unlocked;
  if (chip) {
    chip.textContent = unlocked ? 'offen' : 'gesperrt';
    chip.className = `chip ${unlocked ? 'unlocked' : 'locked'}`;
  }
}

// ---------- View: Locked ----------

function renderLocked(): void {
  stopTicker();
  viewEl.replaceChildren();
  const sync = state.snapshot?.sync;
  const card = h('div', { class: 'card unlock-card' });

  if (sync && !sync.connected) {
    card.append(
      h(
        'div',
        { class: 'banner warn' },
        'Nicht mit Dropbox verbunden.',
        button('Einstellungen öffnen', 'btn small', () => chrome.runtime.openOptionsPage()),
      ),
    );
  }

  const pw = h('input', {
    type: 'password',
    id: 'master-pw',
    placeholder: 'Master-Passwort',
    autocomplete: 'off',
  }) as HTMLInputElement;
  // Datei-Metadaten kompakt: Tresor + Keyfile mit Icons, Namen ohne Prefix.
  const vaultPath = state.snapshot?.settings.remotePath ?? '';
  const vaultName = vaultPath.split('/').pop() || 'export.kdbx';
  const vaultInfo = h('span', { class: 'file-name' }, vaultName);
  if (vaultPath) vaultInfo.title = vaultPath;
  const keyName = h('span', { class: 'file-name dim' }, 'keine .key-Datei');
  const keyInput = h('input', { type: 'file', accept: '.key,.keyx', class: 'file-input' }) as HTMLInputElement;
  keyInput.addEventListener('change', () => {
    const f = keyInput.files?.[0];
    if (f) {
      keyName.textContent = f.name;
      keyName.classList.remove('dim', 'key-status-err');
      keyName.title = '';
    }
  });
  // Native File-Picker-UI ("Browse… No File Selected") ist verwirrend — der
  // Button öffnet den Picker, die Meta-Box zeigt gewählte/vorausgefüllte Datei.
  const keyBtn = button('auswählen', 'btn small', () => keyInput.click());
  const fileMeta = h(
    'div',
    { class: 'file-meta' },
    h('div', { class: 'file-row' }, icon(VAULT_SVG), vaultInfo),
    h('div', { class: 'file-row' }, icon(KEY_SVG), keyName, keyBtn),
  );
  const errBox = h('div', { class: 'banner danger', hidden: 'true' });
  const unlockBtn = button('Entsperren', 'btn primary wide', doUnlock);
  pw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doUnlock();
  });

  async function doUnlock(): Promise<void> {
    errBox.hidden = true;
    unlockBtn.disabled = true;
    let keyFileBase64: string | undefined;
    try {
      const file = keyInput.files?.[0];
      if (file) {
        const buf = await file.arrayBuffer();
        keyFileBase64 = encodeBase64(new Uint8Array(buf));
      } else {
        // Race schließen: Prefill ist async — vor dem Unlock aktiv abwarten
        // (kurz), damit Enter-zu-schnell nicht ohne Keyfile entschlüsselt.
        await prefillPromise;
        if (prefilledKeyB64) keyFileBase64 = prefilledKeyB64;
      }
      state.snapshot = await callBackground<Snapshot>({
        type: 'UNLOCK',
        password: pw.value,
        ...(keyFileBase64 ? { keyFileBase64 } : {}),
      });
      state.view = 'list';
      void showList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errBox.textContent =
        keyFileBase64 === undefined && msg.includes('InvalidKey')
          ? 'Entsperren fehlgeschlagen — Keyfile fehlte (s. Feld unten). ' +
            (nativeKeyError ? `(native: ${nativeKeyError}) ` : '') +
            msg
          : 'Entsperren fehlgeschlagen — Passwort/Keyfile falsch? ' + msg;
      errBox.hidden = false;
    } finally {
      unlockBtn.disabled = false;
    }
  }

  // ADR-010: Keyfile vorab über den Native-Messaging-Host ziehen (agenix).
  // Scheitert es, bleibt die manuelle Dateiauswahl der Weg.
  let prefilledKeyB64: string | undefined;
  let nativeKeyError: string | undefined;
  const prefillPromise: Promise<unknown> = callBackground<{
    b64?: string;
    source?: string;
    name?: string;
    path?: string;
    error?: string;
  }>({
    type: 'PREFILL_KEYFILE',
  })
    .then((res) => {
      if (res.b64) {
        prefilledKeyB64 = res.b64;
        keyName.textContent = res.name ?? 'export.key';
        if (res.path) keyName.title = res.path;
        keyName.classList.remove('dim', 'key-status-err');
      } else if (res.error) {
        nativeKeyError = res.error;
        keyName.textContent = 'nicht verfügbar';
        keyName.classList.add('key-status-err');
        keyName.title = res.error;
      }
    })
    .catch((e: unknown) => {
      nativeKeyError = e instanceof Error ? e.message : String(e);
      keyName.textContent = 'nicht verfügbar';
      keyName.classList.add('key-status-err');
      keyName.title = nativeKeyError;
    });

  card.append(
    h('h2', {}, 'Tresor entsperren'),
    h('label', { class: 'field' }, 'Master-Passwort', pw),
    h('div', { class: 'field' }, fileMeta, keyInput),
    errBox,
    unlockBtn,
  );
  viewEl.append(card);
  pw.focus();
  renderHeader();
}

// ---------- View: Liste ----------

async function showList(): Promise<void> {
  state.view = 'list';
  renderHeader();
  await refreshList();
  startTicker(() => void refreshList());
}

async function refreshList(): Promise<void> {
  const res = await callBackground<{ entries: KeychainEntry[] }>({
    type: 'LIST',
    ...(state.query ? { query: state.query } : {}),
  });
  state.entries = res.entries;
  await refreshTotp(state.entries);
  // Passende Einträge für den aktuellen Tab markieren (ADR-006-Hinweis)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const m = await callBackground<{ entries: KeychainEntry[] }>({
        type: 'MATCH_URL',
        url: tab.url,
      });
      state.matchIds = new Set(m.entries.map((e) => e.id));
    } else {
      state.matchIds = new Set();
    }
  } catch {
    state.matchIds = new Set();
  }
  renderList();
}

function syncBar(): HTMLElement {
  const snap = state.snapshot;
  const bar = h('div', { class: 'sync-bar' });
  if (!snap) return bar;
  const s = snap.sync;
  const status = !s.connected
    ? 'nicht verbunden'
    : s.conflict
      ? 'Konflikt mit Dropbox'
      : s.dirty
        ? 'lokal geändert — nicht hochgeladen'
        : s.rev
          ? `synchron (rev ${s.rev.slice(0, 8)}…)`
          : 'verbunden';
  bar.append(h('span', { class: `sync-status ${s.connected ? '' : 'dim'}` }, '⟳ ', status));

  if (s.conflict) {
    const banner = h(
      'div',
      { class: 'banner warn' },
      h('strong', {}, 'Konflikt: Dropbox hat eine neuere Version.'),
    );
    banner.append(
      button('Remote übernehmen', 'btn', async () => {
        try {
          await callBackground<unknown>({ type: 'CONFLICT_RESOLVE', mode: 'pull' });
          state.snapshot = await callBackground<Snapshot>({ type: 'LOCK_STATE' });
          toast('Remote-Version übernommen');
          await refreshList();
        } catch (e) {
          toast(errorText(e));
        }
      }),
      button('Meine Version hochladen', 'btn primary', async () => {
        try {
          await callBackground<unknown>({ type: 'CONFLICT_RESOLVE', mode: 'push' });
          state.snapshot = await callBackground<Snapshot>({ type: 'LOCK_STATE' });
          toast('Lokale Version hochgeladen');
          await refreshList();
        } catch (e) {
          toast(errorText(e));
        }
      }),
    );
    bar.append(banner);
  }

  if (s.lastError) bar.append(errorBox(s.lastError));

  const actions = h('div', { class: 'sync-actions' });
  actions.append(
    iconButton(UP_SVG, async () => {
      try {
        const res = await callBackground<{ snapshot: Snapshot }>({ type: 'SYNC_PUSH' });
        state.snapshot = res.snapshot;
        toast(s.conflict ? 'Konflikt erkannt' : 'Hochgeladen');
        await refreshList();
      } catch (e) {
        toast(errorText(e));
      }
    }, 'Jetzt hochladen'),
    iconButton(DOWN_SVG, async () => {
      try {
        const res = await callBackground<{ result: string; snapshot: Snapshot }>({
          type: 'SYNC_PULL',
        });
        state.snapshot = res.snapshot;
        if (res.result === 'local-changes') toast('Konflikt: bitte entscheiden');
        else if (res.result === 'cached') toast('Remote zwischengespeichert');
        else toast('Aktualisiert');
        await refreshList();
      } catch (e) {
        toast(errorText(e));
      }
    }, 'Von Dropbox laden'),
    button('+', 'icon-btn accent', () => showEdit(null), 'Neuer Eintrag'),
  );
  bar.append(actions);
  return bar;
}

function renderList(): void {
  if (state.view !== 'list') return;
  renderHeader();
  viewEl.replaceChildren();

  const search = h('input', {
    type: 'search',
    id: 'search',
    placeholder: 'Suchen…',
    value: state.query,
  }) as HTMLInputElement;
  let debounce: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      state.query = search.value;
      void refreshList();
    }, 150);
  });
  viewEl.append(search, syncBar());

  const list = h('ul', { class: 'entry-list', id: 'entries' });
  for (const entry of state.entries) {
    list.append(entryCard(entry));
  }
  if (state.entries.length === 0) {
    list.append(h('li', { class: 'dim empty' }, 'Keine Einträge.'));
  }
  viewEl.append(list);
}

function entryCard(entry: KeychainEntry): HTMLElement {
  const f = entry.fields;
  const li = h('li', { class: 'card entry' });
  if (state.matchIds.has(entry.id)) li.classList.add('matches-tab');

  const head = h(
    'div',
    { class: 'entry-head' },
    h('span', { class: 'entry-title' }, f.title || '(ohne Titel)'),
    f.url ? h('span', { class: 'chip dim-chip' }, hostOf(f.url)) : null,
    state.matchIds.has(entry.id) ? h('span', { class: 'chip ok-chip' }, '✦ diese Seite') : null,
  );

  const sub = h(
    'div',
    { class: 'entry-sub' },
    f.username ? h('span', { class: 'dim' }, f.username) : null,
  );

  const totpInfo = f.totp ? state.totp.get(entry.id) : undefined;
  if (totpInfo) {
    sub.append(
      h(
        'span',
        { class: 'totp-chip', title: 'TOTP kopieren' },
        h('code', { 'data-totp-code': entry.id }, totpInfo.code),
        h('span', { class: 'totp-remaining', 'data-totp-remaining': entry.id }, `${totpInfo.remainingSeconds}s`),
      ),
    );
  }

  const actions = h('div', { class: 'entry-actions' });
  const userBtn = iconButton(USER_SVG, () => void copyField(entry.id, 'username', userBtn), 'Benutzername kopieren');
  const pwBtn = iconButton(KEY_SVG, () => void copyField(entry.id, 'password', pwBtn), 'Passwort kopieren');
  const fillBtn = iconButton(WAND_SVG, async () => {
    try {
      const res = await callBackground<{ filled: FillResult }>({ type: 'FILL', entryId: entry.id });
      const { username, password } = res.filled;
      toast(username || password ? 'Ausgefüllt' : 'Keine Login-Felder gefunden');
      window.close();
    } catch (e) {
      toast(errorText(e));
    }
  }, 'Auf dieser Seite ausfüllen');
  const totpBtn = f.totp
    ? iconButton(CLOCK_SVG, () => void copyField(entry.id, 'totp', totpBtn), 'TOTP kopieren')
    : null;
  actions.append(userBtn, pwBtn, ...(totpBtn ? [totpBtn] : []), fillBtn);

  const openBtn = iconButton(OPEN_SVG, () => {
    if (f.url) chrome.tabs.create({ url: f.url });
  }, 'Website öffnen');
  actions.append(openBtn);

  li.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    void showDetail(entry.id);
  });
  li.append(head, sub, actions);
  return li;
}

// ---------- View: Detail ----------

async function showDetail(id: string): Promise<void> {
  stopTicker();
  state.view = 'detail';
  state.selectedId = id;
  const res = await callBackground<{ entry: KeychainEntry }>({ type: 'GET_ENTRY', entryId: id });
  const entry = res.entry;
  const f = entry.fields;
  renderHeader();
  viewEl.replaceChildren();

  const card = h('div', { class: 'card detail' });
  card.append(
    button('← Zurück', 'btn link', () => void showList()),
    h('h2', {}, f.title || '(ohne Titel)'),
  );

  if (f.username) {
    const btn = iconButton(COPY_SVG, () => void copyField(id, 'username', btn), 'Kopieren');
    card.append(row('Benutzername', rowValue(f.username, btn), btn));
  }
  if (f.password) {
    const codeEl = h('code', { class: 'secret masked row-value copyable' }, '••••••••') as HTMLElement;
    const btn = iconButton(COPY_SVG, () => void copyField(id, 'password', btn), 'Kopieren');
    const toggle = iconButton(EYE_SVG, () => {
      const masked = codeEl.classList.toggle('masked');
      codeEl.textContent = masked ? '••••••••' : f.password!;
    }, 'Anzeigen/Verbergen');
    codeEl.addEventListener('click', () => btn.click());
    card.append(h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Passwort'), codeEl, h('span', { class: 'row-actions' }, toggle, btn)));
  }
  if (f.totp) {
    const info = state.totp.get(id) ?? (await callBackground<TotpInfo | null>({ type: 'TOTP_NOW', entryId: id })) ?? undefined;
    if (info) {
      state.totp.set(id, info);
      const codeEl = h('code', { class: 'totp-big', 'data-totp-code': id }, info.code) as HTMLElement;
      const remaining = h('span', { class: 'totp-remaining', 'data-totp-remaining': id }, `${info.remainingSeconds}s`);
      const btn = iconButton(COPY_SVG, () => void copyField(id, 'totp', btn), 'Kopieren');
      codeEl.classList.add('row-value', 'copyable');
      codeEl.addEventListener('click', () => btn.click());
      card.append(h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'TOTP'), codeEl, remaining, h('span', { class: 'row-actions' }, btn)));
      startTicker(() => void refreshTotp([entry]));
    }
  }
  if (f.url) {
    const open = iconButton(OPEN_SVG, () => chrome.tabs.create({ url: f.url }), 'Website öffnen');
    const fill = iconButton(WAND_SVG, async () => {
      try {
        const r = await callBackground<{ filled: FillResult }>({ type: 'FILL', entryId: id });
        toast(r.filled.username || r.filled.password ? 'Ausgefüllt' : 'Keine Login-Felder gefunden');
        window.close();
      } catch (e) {
        toast(errorText(e));
      }
    }, 'Ausfüllen');
    const hostEl = rowValue(hostOf(f.url));
    hostEl.title = f.url;
    card.append(h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Website'), hostEl, h('span', { class: 'row-actions' }, open, fill)));
  }
  for (const [key, cf] of Object.entries(f.customFields ?? {})) {
    const shown = cf.secret ? `${cf.value.slice(0, 2)}••••` : cf.value;
    const btn = iconButton(COPY_SVG, () => void copyField(id, `custom:${key}`, btn), 'Kopieren');
    card.append(h('div', { class: 'row' }, h('span', { class: 'row-label' }, key), rowValue(shown, btn), h('span', { class: 'row-actions' }, btn)));
  }
  if (f.notes) card.append(h('div', { class: 'notes' }, f.notes));

  card.append(h('hr'));

  let confirmDelete = false;
  const delBtn = button('Löschen', 'btn danger', async () => {
    if (!confirmDelete) {
      confirmDelete = true;
      delBtn.textContent = 'Wirklich löschen?';
      return;
    }
    try {
      const r = await callBackground<{ snapshot: Snapshot }>({ type: 'DELETE_ENTRY', entryId: id });
      state.snapshot = r.snapshot;
      toast('Eintrag gelöscht (Papierkorb)');
      await showList();
    } catch (e) {
      toast(errorText(e));
    }
  });
  card.append(
    h('div', { class: 'detail-actions' },
      button('Bearbeiten', 'btn', () => void showEdit(id)),
      delBtn,
    ),
  );
  viewEl.append(card);
}

function row(label: string, value: string | HTMLElement, ...actions: HTMLElement[]): HTMLElement {
  const valueEl = typeof value === 'string' ? h('span', { class: 'row-value' }, value) : value;
  const actionsEl = h('span', { class: 'row-actions' }, ...actions);
  return h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), valueEl, actionsEl);
}

/** Wert mit Ellipsis; Klick löst den Copy-Button der Zeile aus (auch bei Abschnitt). */
function rowValue(text: string, copyBtn?: HTMLButtonElement): HTMLElement {
  const el = h('span', { class: 'row-value', title: text }, text) as HTMLElement;
  if (copyBtn) {
    el.classList.add('copyable');
    el.addEventListener('click', () => copyBtn.click());
  }
  return el;
}

// ---------- View: Edit / Create ----------

async function showEdit(id: string | null): Promise<void> {
  stopTicker();
  state.view = 'edit';
  state.editingId = id;
  const entry = id
    ? (await callBackground<{ entry: KeychainEntry }>({ type: 'GET_ENTRY', entryId: id })).entry
    : null;
  const f = entry?.fields;
  renderHeader();
  viewEl.replaceChildren();

  const titleIn = h('input', { type: 'text', placeholder: 'Titel *', value: f?.title ?? '' }) as HTMLInputElement;
  const userIn = h('input', { type: 'text', placeholder: 'Benutzername / E-Mail', value: f?.username ?? '' }) as HTMLInputElement;
  const pwIn = h('input', { type: 'password', placeholder: 'Passwort', value: f?.password ?? '', autocomplete: 'new-password' }) as HTMLInputElement;
  const urlIn = h('input', { type: 'url', placeholder: 'https://…', value: f?.url ?? '' }) as HTMLInputElement;
  const notesIn = h('textarea', { placeholder: 'Notizen', rows: '3' }) as HTMLTextAreaElement;
  notesIn.value = f?.notes ?? '';
  const totpIn = h('input', {
    type: 'text',
    placeholder: 'TOTP: otpauth://… oder Base32-Seed',
    value: f?.totp ? buildOtpUri(f.totp) : '',
  }) as HTMLInputElement;

  const errBox = h('div', { class: 'banner danger', hidden: 'true' });

  async function parseTotp(raw: string): Promise<TotpConfig | undefined | 'invalid'> {
    const text = raw.trim();
    if (!text) return undefined;
    const parsed = parseOtpUri(text);
    if (parsed) return parsed;
    if (/^[A-Za-z2-7=\s-]{8,}$/.test(text)) {
      return { secret: text.replace(/[\s-]/g, ''), digits: 6, period: 30, algorithm: 'SHA1' };
    }
    return 'invalid';
  }

  const save = async (): Promise<void> => {
    errBox.hidden = true;
    if (!titleIn.value.trim()) {
      errBox.textContent = 'Titel ist erforderlich.';
      errBox.hidden = false;
      return;
    }
    const totp = await parseTotp(totpIn.value);
    if (totp === 'invalid') {
      errBox.textContent = 'TOTP-Eingabe ist kein otpauth://-URI oder Base32-Seed.';
      errBox.hidden = false;
      return;
    }
    const patch = {
      title: titleIn.value.trim(),
      ...(userIn.value ? { username: userIn.value } : {}),
      ...(pwIn.value ? { password: pwIn.value } : {}),
      ...(urlIn.value ? { url: urlIn.value } : {}),
      ...(notesIn.value ? { notes: notesIn.value } : {}),
      ...(totp ? { totp } : {}),
    };
    try {
      if (id) {
        const res = await callBackground<{ snapshot: Snapshot }>({
          type: 'UPDATE_ENTRY',
          entryId: id,
          patch,
          clearTotp: !totp && !!f?.totp,
        });
        state.snapshot = res.snapshot;
      } else {
        const res = await callBackground<{ snapshot: Snapshot }>({
          type: 'CREATE_ENTRY',
          // Formular liefert nur gesetzte Felder; Titel ist vorher validiert.
          fields: patch as unknown as EntryFields,
        });
        state.snapshot = res.snapshot;
      }
      toast('Gespeichert');
      await showList();
    } catch (e) {
      errBox.textContent = errorText(e);
      errBox.hidden = false;
    }
  };

  const card = h(
    'div',
    { class: 'card edit' },
    button('← Abbrechen', 'btn link', () => void showList()),
    h('h2', {}, id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'),
    h('label', { class: 'field' }, 'Titel', titleIn),
    h('label', { class: 'field' }, 'Benutzername', userIn),
    h('label', { class: 'field' }, 'Passwort', pwIn),
    h('label', { class: 'field' }, 'Website', urlIn),
    h('label', { class: 'field' }, 'TOTP (optional)', totpIn),
    h('label', { class: 'field' }, 'Notizen', notesIn),
    errBox,
    button(id ? 'Speichern' : 'Anlegen', 'btn primary wide', () => void save()),
  );
  viewEl.append(card);
}

// ---------- Boot ----------

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

lockBtn.addEventListener('click', async () => {
  const snap = await callBackground<Snapshot>({ type: 'LOCK' });
  state.snapshot = snap;
  state.view = 'locked';
  renderLocked();
});
optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

(async function boot(): Promise<void> {
  try {
    state.snapshot = await callBackground<Snapshot>({ type: 'LOCK_STATE' });
    if (state.snapshot.unlocked) await showList();
    else renderLocked();
  } catch (e) {
    viewEl.replaceChildren(errorBox(errorText(e)));
  }
})();
