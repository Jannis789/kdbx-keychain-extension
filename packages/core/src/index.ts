/**
 * Öffentliche API von `@kdbx-keychain/core`: Modell, Ports, Adapter.
 * Die Extension importiert ausschließlich hierüber (keine Tiefenimporte).
 */
export * from './model/entry';
export * from './model/totp';
export * from './model/matching';
export * from './model/settings';
export * from './model/unlock';
export * from './ports/database';
export * from './ports/cloud';
export { DropboxCloud, buildAuthUrl, exchangeCode, generatePkce } from './adapters/dropbox';
export {
  KdbxDatabase,
  KdbxDatabasePort,
  createKdbxDatabasePort,
  createEmptyDatabase,
} from './adapters/kdbx';
