/**
 * MV3-Service-Worker-Einstiegspunkt: Chrome-Wiring für
 * Vault + Router + Clipboard-Alarm + Kontextmenü + Shortcut.
 */
import { createKdbxDatabasePort, DropboxCloud } from '@kdbx-keychain/core';
import { AUTO_LOCK_ALARM, Vault, type CloudFactory } from './vault';
import { CLIPBOARD_CLEAR_ALARM, clearClipboardIfExpected } from './clipboard';
import { chromeAlarms, chromeKV } from './ports';
import { createRouter, matchAndFillActiveTab } from './router';
import { hasAppKey, APP_KEY, APP_SECRET } from './app-key';
import type { RuntimeMessage } from '../shared/messages';

const cloudFactory: CloudFactory = ({ refreshToken, onTokenRefreshed }) => {
  if (!hasAppKey()) return null;
  return new DropboxCloud({
    appKey: APP_KEY,
    ...(APP_SECRET ? { appSecret: APP_SECRET } : {}),
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
  (message: { type?: string } | undefined, sender, sendResponse): boolean => {
    const type = message?.type;
    if (type === 'CLIPBOARD_WRITE' || type === 'CLIPBOARD_CLEAR_IF_SAME') {
      return false; // intern: nur fürs Offscreen-Dokument (ADR-009)
    }
    route(message as RuntimeMessage, sender).then(sendResponse);
    return true; // async
  },
);

// ---------- Alarms ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void vault.checkAutoLock();
  else if (alarm.name === CLIPBOARD_CLEAR_ALARM) void clearClipboardIfExpected();
});

// ---------- Badge-Feedback ----------

function badge(text: string, color = '#26a269'): void {
  try {
    void chrome.action.setBadgeBackgroundColor({ color });
    void chrome.action.setBadgeText({ text });
    setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2000);
  } catch {
    // kosmetisch — ignorieren
  }
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
