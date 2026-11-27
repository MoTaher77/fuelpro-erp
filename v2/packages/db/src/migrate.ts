import { Migrator, type Kysely, type Migration } from 'kysely';
import type { Dialect } from '@fuelpro/core';
import { m001 } from './migrations/001_core.ts';

/** Migrations are bundled as code (no file-system scan), so the same list runs on the server, in Tauri and in Capacitor. */
export function migrations(dialect: Dialect): Record<string, Migration> {
  return { '001_core': m001(dialect) };
}
export async function migrate(db: Kysely<any>, dialect: Dialect): Promise<string[]> {
  const m = new Migrator({ db, provider: { getMigrations: async () => migrations(dialect) } });
  const { error, results } = await m.migrateToLatest();
  if (error) throw error;
  return (results || []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
