/**
 * Chrome-Adapter für die Vault-Ports. Der Vault selbst bleibt browser-frei
 * (Testbarkeit) — hier ist der einzige Ort, der chrome.*-APIs kapselt.
 */
import type { AlarmScheduler, KVStore } from './vault';

function wrap<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve) => fn((result) => resolve(result)));
}

export function chromeKV(area: chrome.storage.StorageArea): KVStore {
  return {
    async get(key) {
      const items = await wrap<Record<string, unknown>>((cb) => area.get(key, cb));
      return items[key];
    },
    async set(key, value) {
      await wrap<void>((cb) => area.set({ [key]: value }, cb));
    },
    async remove(key) {
      await wrap<void>((cb) => area.remove(key, cb));
    },
  };
}

export function chromeAlarms(): AlarmScheduler {
  return {
    async create(name, delaySeconds) {
      await wrap<void>((cb) =>
        chrome.alarms.create(name, { delayInMinutes: delaySeconds / 60 }, cb),
      );
    },
    async clear(name) {
      await wrap<boolean>((cb) => chrome.alarms.clear(name, cb));
    },
  };
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await wrap<chrome.tabs.Tab[]>((cb) =>
    chrome.tabs.query({ active: true, currentWindow: true }, cb),
  );
  return tabs[0] ?? null;
}

export async function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  const res = await wrap<T | undefined>((cb) => chrome.tabs.sendMessage(tabId, message, (r) => {
    const err = chrome.runtime.lastError;
    if (err) throw new Error(`Seite nicht erreichbar: ${err.message}`);
    cb(r);
  }));
  return res as T;
}
