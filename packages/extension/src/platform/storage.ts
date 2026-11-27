/** Port-Adapter: chrome.storage → KVStore (Vault kennt nur das Interface). */
import type { KVStore } from '../features/vault/ports';
import { wrap } from './wrap';

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
