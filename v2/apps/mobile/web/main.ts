/* Phone edition (Capacitor): the shared UI + the core on a native SQLite database inside the app's private storage.
   Works with no network at all. */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { capacitorBridge, openBridge } from '@fuelpro/db/browser';
import { localBackend } from '@fuelpro/local';
import { mount } from '@fuelpro/ui';

async function open() {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const ok = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection('fuelpro', false)).result;
  const db = ok && exists ? await sqlite.retrieveConnection('fuelpro', false) : await sqlite.createConnection('fuelpro', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;', false);
  return openBridge(capacitorBridge(db as unknown as Parameters<typeof capacitorBridge>[0]));
}
mount(document.getElementById('app')!, localBackend(open, 'phone'));
