/* v1 (the system in use) and v2 (TypeScript core) must agree to the minor unit on SQLite and PostgreSQL.
   PostgreSQL runs when V2_PG_URL points at a server where the user may create databases (CI service). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { openSqlite, openPostgres, openBridge } from '@fuelpro/db';
import { nodeBridge } from './bridge-fake.ts';
import { play } from './scenario.ts';
import { v1Api, v2Api } from './adapters.ts';
import { DUMP_SQL, norm, stripTimes } from './dump.ts';
import type { Ctx } from '@fuelpro/core';
import { withPgDatabase } from './pg-temp.ts';

async function v1Run(seed: number) {
  const v1 = v1Api();
  const out = await play(v1.api, seed);
  const dump: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(DUMP_SQL)) dump[k] = norm(await v1.all(q) as Array<Record<string, unknown>>);
  await v1.close();
  return { out: stripTimes(out), dump };
}
async function v2Run(ctx: Ctx, seed: number) {
  const v2 = v2Api(ctx);
  const out = await play(v2.api, seed);
  const dump: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(DUMP_SQL)) dump[k] = norm((await sql.raw(q).execute(ctx.db)).rows as Array<Record<string, unknown>>);
  return { out: stripTimes(out), dump };
}
function same(a: { out: unknown; dump: Record<string, unknown> }, b: { out: unknown; dump: Record<string, unknown> }) {
  for (const k of Object.keys(DUMP_SQL)) assert.deepEqual(b.dump[k], a.dump[k], `table ${k} differs`);
  assert.deepEqual(b.out, a.out, 'operation results differ');
}

for (const seed of [7, 2026]) {
  test(`parity seed ${seed}: v1 = v2 on SQLite`, async () => {
    const a = await v1Run(seed);
    const ctx = await openSqlite(':memory:');
    try { same(a, await v2Run(ctx, seed)); } finally { await ctx.close(); }
    const counts = (a.dump.counts as Array<{ sales: number }>)[0];
    assert.ok(counts.sales > 100, 'the scenario records real volume');
  });
  test(`parity seed ${seed}: v1 = v2 on SQLite through the desktop/phone bridge`, async () => {
    const a = await v1Run(seed);
    const ctx = await openBridge(nodeBridge());
    try { same(a, await v2Run(ctx, seed)); } finally { await ctx.close(); }
  });
  test(`parity seed ${seed}: v1 = v2 on PostgreSQL`, { skip: !process.env.V2_PG_URL && 'set V2_PG_URL to run' }, async () => {
    const a = await v1Run(seed);
    await withPgDatabase(process.env.V2_PG_URL!, async (url) => {
      const ctx = await openPostgres(url, { max: 4 });
      try { same(a, await v2Run(ctx, seed)); } finally { await ctx.close(); }
    });
  });
}

/* ---------- phase 2: stock & deliveries ---------- */
import { playStock } from './scenario-stock.ts';
async function v1Stock(seed: number) {
  const v1 = v1Api(); const out = await playStock(v1.stockApi, seed);
  const dump: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(DUMP_SQL)) dump[k] = norm(await v1.all(q) as Array<Record<string, unknown>>);
  await v1.close(); return { out: stripTimes(out), dump };
}
async function v2Stock(ctx: Ctx, seed: number) {
  const v2 = v2Api(ctx); const out = await playStock(v2.stockApi, seed);
  const dump: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(DUMP_SQL)) dump[k] = norm((await sql.raw(q).execute(ctx.db)).rows as Array<Record<string, unknown>>);
  return { out: stripTimes(out), dump };
}
for (const seed of [11, 404]) {
  test(`stock parity seed ${seed}: v1 = v2 on SQLite`, async () => {
    const a = await v1Stock(seed); const ctx = await openSqlite(':memory:');
    try { same(a, await v2Stock(ctx, seed)); } finally { await ctx.close(); }
    const n = (a.dump.deliveries as unknown[]).length; assert.ok(n >= 10, 'deliveries recorded: ' + n);
  });
  test(`stock parity seed ${seed}: v1 = v2 through the desktop/phone bridge`, async () => {
    const a = await v1Stock(seed); const ctx = await openBridge(nodeBridge());
    try { same(a, await v2Stock(ctx, seed)); } finally { await ctx.close(); }
  });
  test(`stock parity seed ${seed}: v1 = v2 on PostgreSQL`, { skip: !process.env.V2_PG_URL && 'set V2_PG_URL to run' }, async () => {
    const a = await v1Stock(seed);
    await withPgDatabase(process.env.V2_PG_URL!, async (url) => { const ctx = await openPostgres(url, { max: 4 }); try { same(a, await v2Stock(ctx, seed)); } finally { await ctx.close(); } });
  });
}
