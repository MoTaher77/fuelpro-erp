import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
/** A throwaway database for one test, dropped afterwards. */
export async function withPgDatabase(adminUrl: string, fn: (url: string) => Promise<void>) {
  const pg = require('pg') as typeof import('pg');
  const name = 'fp_v2_test_' + randomBytes(5).toString('hex');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(adminUrl); u.pathname = '/' + name;
  try { await fn(u.toString()); }
  finally {
    // pg-pool's end() resolves before the sockets have closed; wait for them so DROP does not have to kill live sessions
    for (let i = 0; i < 50; i++) {
      const r = await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname = $1', [name]);
      if (r.rows[0].n === 0) break;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end();
  }
}
