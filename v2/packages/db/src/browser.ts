/* Entry for the desktop and phone bundles: no node:* imports. */
export { migrate, migrations } from './migrate.ts';
export { openBridge, BridgeDialect, type SqliteBridge } from './sqlite-async.ts';
export { tauriBridge } from './bridge-tauri.ts';
export { capacitorBridge } from './bridge-capacitor.ts';
