/* Desktop (Tauri 2): the SQLite file lives next to the app data; Rust (rusqlite, one connection) runs each statement.
   See apps/desktop/src-tauri/src/main.rs — commands db_exec. */
import type { SqliteBridge } from './sqlite-async.ts';
type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
export function tauriBridge(invoke: Invoke): SqliteBridge {
  return {
    async exec(sql, params, reader) {
      return await invoke('db_exec', { sql, params, reader }) as { rows: Record<string, unknown>[]; changes: number; lastId: number };
    }
  };
}
