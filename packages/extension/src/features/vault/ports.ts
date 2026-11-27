/**
 * Ports des Vaults (Dependency Inversion): der Vault kennt nur diese
 * Schnittstellen — die Browser-Adapter liegen in `platform/`, Tests faken sie.
 */
import type { CloudPort } from '@kdbx-keychain/core';

export interface KVStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AlarmScheduler {
  create(name: string, delaySeconds: number): Promise<void>;
  clear(name: string): Promise<void>;
}

export type CloudFactory = (opts: {
  refreshToken: string;
  onTokenRefreshed(refreshToken: string): void;
}) => CloudPort | null;
