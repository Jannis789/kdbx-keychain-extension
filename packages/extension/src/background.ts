/**
 * Phase-0-Skeleton. Phase 3 baut hier den Message-Router
 * (Unlock/Lock/List/Fill/Copy/CRUD/Sync) sowie:
 *  - Stay-open: abgeleiteter Key ausschließlich in chrome.storage.session (ADR-004)
 *  - Clipboard-Auto-Clear via chrome.alarms (ADR-009)
 *  - Kontextmenü „Mit KDBX Keychain ausfüllen“ (ADR-006)
 */
import type { RuntimeMessage, RuntimeResponse } from './shared/messages';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'kdbx-fill',
    title: 'Mit KDBX Keychain ausfüllen',
    contexts: ['editable'],
  });
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse): boolean => {
    const response: RuntimeResponse = {
      ok: false,
      error: `not-implemented: ${message.type} (Phase 3)`,
    };
    sendResponse(response);
    return false;
  },
);
