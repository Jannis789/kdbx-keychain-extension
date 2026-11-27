/** Port-Adapter: chrome.alarms → AlarmScheduler (Auto-Lock, ADR-004). */
import type { AlarmScheduler } from '../features/vault/vault';
import { wrap } from './wrap';

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
