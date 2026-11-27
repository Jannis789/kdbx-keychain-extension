/**
 * Message-Router: verbindet UI-Nachrichten (Popup/Options) mit dem Vault.
 * Jede Aktion mit Tresorzugriff verlängert das Auto-Lock-Fenster (touch).
 */
import type { EntryFields } from '@kdbx-keychain/core';
import type {
  FillResult,
  RuntimeMessage,
  RuntimeResponse,
  Snapshot,
  TotpInfo,
} from '../shared/messages';
import { connectDropboxPkce, dropboxRedirectUri } from './oauth';
import { dropboxAppConfig, saveDropboxAppConfig } from './dropbox-config';
import { fetchKeyfileViaNative } from './native';
import {
  ensureContentScript,
  getActiveTab,
  sendTabMessage,
} from './ports';
import type { Vault } from './vault';

function ok<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

async function fillEntry(vault: Vault, entryId: string): Promise<{ filled: FillResult; title: string }> {
  const entry = await vault.getEntry(entryId);
  const tab = await getActiveTab();
  const tabId = tab?.id;
  if (!tabId) throw new Error('Kein aktiver Tab gefunden');
  const fields = entry.fields;
  const totp = fields.totp ? (await vault.totpNow(entryId))?.code : undefined;
  const payload: RuntimeMessage = {
    type: 'FILL_INTO_DOM',
    ...(fields.username ? { username: fields.username } : {}),
    ...(fields.password ? { password: fields.password } : {}),
    ...(totp ? { totp } : {}),
  };
  await ensureContentScript(tabId);
  const filled = await sendTabMessage<FillResult>(tabId, payload);
  return { filled, title: fields.title };
}

/** Für Kontextmenü + Shortcut: besten Treffer für den aktiven Tab füllen. */
export async function matchAndFillActiveTab(
  vault: Vault,
): Promise<{ filled: FillResult; title: string } | 'no-match'> {
  const tab = await getActiveTab();
  if (!tab?.url) throw new Error('Aktueller Tab hat keine URL');
  await vault.touch();
  const entries = await vault.matchUrl(tab.url);
  if (entries.length === 0) return 'no-match';
  return fillEntry(vault, entries[0]!.id);
}

export type Route = (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
) => Promise<RuntimeResponse>;

export function createRouter(vault: Vault): Route {
  return async (message) => {
    try {
      switch (message.type) {
        case 'UNLOCK':
          await vault.unlock(message.password, message.keyFileBase64);
          return ok(await vault.snapshot());
        case 'LOCK':
          await vault.lock();
          return ok(await vault.snapshot());
        case 'LOCK_STATE':
          return ok(await vault.snapshot());
        case 'LIST':
          await vault.touch();
          return ok({ entries: await vault.list(message.query) });
        case 'GET_ENTRY':
          await vault.touch();
          return ok({ entry: await vault.getEntry(message.entryId) });
        case 'MATCH_URL':
          await vault.touch();
          return ok({ entries: await vault.matchUrl(message.url) });
        case 'TOTP_NOW': {
          await vault.touch();
          const info: TotpInfo | null = await vault.totpNow(message.entryId);
          return ok(info);
        }
        case 'READ_FIELD': {
          await vault.touch();
          const value = await vault.readField(message.entryId, message.field);
          if (!value) throw new Error('Feld ist leer');
          return ok({ value });
        }
        case 'FILL':
          await vault.touch();
          return ok(await fillEntry(vault, message.entryId));
        case 'PREFILL_KEYFILE': {
          // ADR-010: Keyfile-Bytes aus dem Native-Host (agenix) — weiches
          // Fallback: kein Host → leeres Objekt + Diagnose-Text → Popup.
          const { b64, path, error } = await fetchKeyfileViaNative();
          const name = path ? path.split('/').pop() : undefined;
          return ok(
            b64
              ? {
                  b64,
                  source: 'native',
                  ...(name ? { name } : {}),
                  ...(path ? { path } : {}),
                }
              : { ...(error ? { error } : {}) },
          );
        }
        case 'CREATE_ENTRY': {
          const entry = await vault.createEntry(message.fields as EntryFields);
          return ok({ entry, snapshot: await vault.snapshot() });
        }
        case 'UPDATE_ENTRY': {
          const entry = await vault.updateEntry(
            message.entryId,
            message.patch as Partial<EntryFields>,
            message.clearTotp === true,
          );
          return ok({ entry, snapshot: await vault.snapshot() });
        }
        case 'DELETE_ENTRY': {
          await vault.removeEntry(message.entryId);
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'SYNC_PUSH': {
          const result = await vault.push();
          return ok({ result, snapshot: await vault.snapshot() });
        }
        case 'SYNC_PULL': {
          const result = await vault.pull(message.force === true);
          return ok({ result, snapshot: await vault.snapshot() });
        }
        case 'CONFLICT_RESOLVE': {
          await vault.resolveConflict(message.mode);
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'CONNECT_DROPBOX': {
          await connectDropboxPkce(vault);
          await vault.pushBestEffort();
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'SET_REFRESH_TOKEN': {
          await vault.setRefreshToken(message.refreshToken);
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'DISCONNECT_DROPBOX': {
          await vault.disconnect();
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'SET_SETTINGS': {
          await vault.setSettings(message.patch);
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'GET_DROPBOX_APP': {
          const cfg = dropboxAppConfig();
          return ok({
            appKey: cfg.appKey,
            appSecret: cfg.appSecret,
            redirectUri: dropboxRedirectUri(),
          });
        }
        case 'SET_DROPBOX_APP': {
          await saveDropboxAppConfig({
            appKey: message.appKey,
            appSecret: message.appSecret,
          });
          vault.invalidateCloud();
          return ok({ snapshot: await vault.snapshot() });
        }
        case 'FILL_INTO_DOM':
          return { ok: false, error: 'FILL_INTO_DOM ist nur für Content-Scripts (chrome.tabs)' };
        default: {
          const exhaustive: never = message;
          return { ok: false, error: `Unbekannter Nachrichtentyp: ${JSON.stringify(exhaustive)}` };
        }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}
