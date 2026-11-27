/**
 * MV3-Service-Worker-Einstiegspunkt: Chrome-Wiring für
 * Vault + Router + Kontextmenü + Shortcut.
 */
import { createKdbxDatabasePort, DropboxCloud } from '@kdbx-keychain/core';
import type { CloudFactory } from './features/vault/ports';
import { AUTO_LOCK_ALARM, Vault } from './features/vault/vault';
import { chromeAlarms } from './platform/alarms';
import { chromeKV } from './platform/storage';
import { createRouter, matchAndFillActiveTab } from './router';
import {
  hasResolvedAppKey,
  loadDropboxAppConfig,
  resolvedAppKey,
  resolvedAppSecret,
  resolvedRefreshToken,
  resolvedRemotePath,
} from './features/sync/credentials';
import type { RuntimeMessage } from './shared/messages';

const cloudFactory: CloudFactory = ({ refreshToken, onTokenRefreshed }) => {
  // ADR-012: Options-Pflege schlägt Build-Injection (dropbox-config-Resolution).
  if (!hasResolvedAppKey()) return null;
  const appSecret = resolvedAppSecret();
  return new DropboxCloud({
    appKey: resolvedAppKey(),
    ...(appSecret ? { appSecret } : {}),
    refreshToken,
    onTokenRefreshed: (t) => onTokenRefreshed(t.refreshToken),
  });
};

const vault = new Vault({
  session: chromeKV(chrome.storage.session),
  local: chromeKV(chrome.storage.local),
  alarms: chromeAlarms(),
  port: createKdbxDatabasePort(),
  cloudFactory,
  // Credentials laden, BEVOR init()/cloudFactory greift (Reihenfolge-Garantie).
  ready: loadDropboxAppConfig(),
  // Host-Seed (ADR-012): erst NACH `ready` auslesen — der Cache ist dann voll.
  seed: () => ({ refreshToken: resolvedRefreshToken(), remotePath: resolvedRemotePath() }),
});

const route = createRouter(vault);

// ---------- Install ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'kdbx-fill',
    title: 'Mit KDBX Keychain ausfüllen',
    contexts: ['editable'],
  });
});

// ---------- Messages ----------

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse): boolean => {
    route(message, sender).then(sendResponse);
    return true; // async
  },
);

// ---------- Alarms ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void vault.checkAutoLock();
});

// ---------- Badge-Feedback ----------

function badge(text: string, color = '#26a269'): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2000);
}

async function quickFill(): Promise<void> {
  try {
    const result = await matchAndFillActiveTab(vault);
    if (result === 'no-match') badge('?', '#c01c28');
    else badge('✓');
  } catch {
    badge('!', '#c01c28');
  }
}

// ---------- Shortcut + Kontextmenü (ADR-006) ----------

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'fill-current-tab') void quickFill();
});

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === 'kdbx-fill') void quickFill();
});
