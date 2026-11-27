/**
 * Tab-Adapter (ADR-006): aktiven Tab holen, Content-Script injizieren, füllen.
 * Der Vault/Feature-Code kennt nur diese Funktionen, kein chrome.tabs.
 */
import { wrap } from './wrap';

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await wrap<chrome.tabs.Tab[]>((cb) =>
    chrome.tabs.query({ active: true, currentWindow: true }, cb),
  );
  return tabs[0] ?? null;
}

export async function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  const res = await wrap<T | undefined>((cb) =>
    chrome.tabs.sendMessage(tabId, message, (r) => {
      const err = chrome.runtime.lastError;
      if (err) throw new Error(`Seite nicht erreichbar: ${err.message}`);
      cb(r);
    }),
  );
  return res as T;
}

/**
 * Stellt sicher, dass content.js im Tab vorhanden ist.
 *
 * Firefox MV3 injiziert Manifest-Content-Scripts erst, sobald Host-Permissions
 * gewährt sind — mit activeTab (User-Intent: Popup/Kontextmenü/Shortcut) können
 * wir dennoch injecten. Idempotent dank Guard in content-script.ts; Fehler
 * (z. B. geschützte Seite, kein activeTab) werden bewusst ignoriert — der
 * folgende sendMessage liefert dann die benutzerfreundliche Meldung.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  if (typeof chrome.scripting?.executeScript !== 'function') return;
  try {
    await wrap<unknown>((cb) =>
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, (r) => {
        void chrome.runtime.lastError; // ignorieren — siehe oben
        cb(r);
      }),
    );
  } catch {
    // siehe oben — sendMessage liefert die aussagekräftige Fehlermeldung
  }
}
