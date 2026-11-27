/** Options-Seite (Phase 3): Dropbox-Verbindung + Auto-Lock/Clipboard/Pfad. */
import { callBackground } from '../shared/ipc';
import type { Snapshot } from '../shared/messages';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = $('dropbox-status');
const autolockIn = $<HTMLInputElement>('set-autolock');
const clipboardIn = $<HTMLInputElement>('set-clipboard');
const remotePathIn = $<HTMLInputElement>('set-remotepath');
const tokenIn = $<HTMLTextAreaElement>('refresh-token');
const toastEl = $('toast');

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function applySnapshot(snap: Snapshot): void {
  statusEl.textContent = snap.sync.connected ? 'verbunden' : 'nicht verbunden';
  statusEl.className = `chip ${snap.sync.connected ? 'unlocked' : 'dim-chip'}`;
  autolockIn.value = String(snap.settings.autoLockMinutes);
  clipboardIn.value = String(snap.settings.clipboardClearSeconds);
  remotePathIn.value = snap.settings.remotePath;
}

$('btn-connect').addEventListener('click', async () => {
  try {
    const res = await callBackground<{ snapshot: Snapshot }>({ type: 'CONNECT_DROPBOX' });
    applySnapshot(res.snapshot);
    toast('Mit Dropbox verbunden');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

$('btn-disconnect').addEventListener('click', async () => {
  try {
    const res = await callBackground<{ snapshot: Snapshot }>({ type: 'DISCONNECT_DROPBOX' });
    applySnapshot(res.snapshot);
    toast('Verbindung getrennt');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

$('btn-token').addEventListener('click', async () => {
  try {
    // rclone.conf speichert {"access_token":…,"refresh_token":…} als token=JSON
    let raw = tokenIn.value.trim();
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { refresh_token?: string };
        raw = parsed.refresh_token ?? raw;
      } catch {
        // nicht-JSON → Rohwert verwenden
      }
    }
    const res = await callBackground<{ snapshot: Snapshot }>({
      type: 'SET_REFRESH_TOKEN',
      refreshToken: raw,
    });
    applySnapshot(res.snapshot);
    tokenIn.value = '';
    toast('Refresh-Token übernommen');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

const appKeyIn = $<HTMLInputElement>('set-appkey');
const appSecretIn = $<HTMLInputElement>('set-appsecret');

$('btn-app').addEventListener('click', async () => {
  try {
    // Leere Felder = löschen → Build-Fallback (ADR-007) greift wieder.
    const res = await callBackground<{ appKey: string; appSecret: string }>({
      type: 'SET_DROPBOX_APP',
      appKey: appKeyIn.value.trim(),
      appSecret: appSecretIn.value.trim(),
    });
    appKeyIn.value = res.appKey;
    appSecretIn.value = res.appSecret;
    toast('Dropbox-Credentials übernommen');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

$('btn-save').addEventListener('click', async () => {
  try {
    const res = await callBackground<{ snapshot: Snapshot }>({
      type: 'SET_SETTINGS',
      patch: {
        autoLockMinutes: Number(autolockIn.value),
        clipboardClearSeconds: Number(clipboardIn.value),
        remotePath: remotePathIn.value,
      },
    });
    applySnapshot(res.snapshot);
    toast('Gespeichert');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

(async function boot(): Promise<void> {
  try {
    const snap = await callBackground<Snapshot>({ type: 'LOCK_STATE' });
    applySnapshot(snap);
    const app = await callBackground<{ appKey: string; appSecret: string }>({ type: 'GET_DROPBOX_APP' });
    appKeyIn.value = app.appKey;
    appSecretIn.value = app.appSecret;
    const uri = chrome.identity?.getRedirectURL?.() ?? '';
    $('redirect-uri').textContent = uri || '(Chrome-Redirect-URI nicht verfügbar)';
    // Firefox unterstützt chrome.identity (launchWebAuthFlow) gleichermaßen;
    // nur die Redirect-URI unterscheidet sich (extensions.allizom.org statt
    // chromiumapp.org) und muss zusätzlich in der Dropbox-Konsole registriert
    // werden. Ohne identity-API (Alt-Builds) bleibt der Token-Import.
    if (typeof chrome.identity?.launchWebAuthFlow !== 'function') {
      ($('btn-connect') as HTMLButtonElement).hidden = true;
      $('redirect-uri').textContent =
        '(identity-API nicht verfügbar — Token manuell importieren)';
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
})();
