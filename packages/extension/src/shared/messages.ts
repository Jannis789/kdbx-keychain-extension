/** Message-Vertrag zwischen Popup/Content-Script und Background (Phase 3 aktiviert). */

export type CopyableField = 'password' | 'username' | 'totp' | (string & {});

export type RuntimeMessage =
  | { type: 'UNLOCK'; password: string; keyFileBase64?: string }
  | { type: 'LOCK' }
  | { type: 'LOCK_STATE' }
  | { type: 'LIST'; query?: string }
  | { type: 'MATCH_URL'; url: string }
  | { type: 'COPY'; entryId: string; field: CopyableField }
  | { type: 'FILL'; entryId: string }
  | { type: 'CREATE_ENTRY'; fields: unknown }
  | { type: 'UPDATE_ENTRY'; entryId: string; patch: unknown }
  | { type: 'DELETE_ENTRY'; entryId: string }
  | { type: 'SYNC_PUSH' }
  | { type: 'SYNC_PULL' };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
