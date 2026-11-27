'use strict';
// Prints markdown tables from results/*.json
const fs = require('fs'), path = require('path'); const dir = path.join(__dirname, '..', 'results');
const stacks = ['node-http', 'node-fastify', 'node-hono', 'bun-hono', 'go', 'rust'], dbs = ['sqlite', 'pg'];
const name = { 'node-http': 'Node node:http', 'node-fastify': 'Node Fastify 5', 'node-hono': 'Node Hono', 'bun-hono': 'Bun Hono', go: 'Go net/http', rust: 'Rust axum' };
const get = (s, d, e) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${s}-${d}-${e}.json`))); } catch { return null; } };
const titles = { list: '1. GET /stations/:sid/sales?limit=50 (100 conn)', summary: '2. GET /stations/:sid/summary (100 conn)', summary1: '2b. GET summary at 1 connection (service time, no queueing)', post: '3. POST /stations/:sid/sales (100 conn, pure writes)' };
for (const e of ['list', 'summary', 'summary1', 'post']) {
  console.log(`\n### ${titles[e]}\n\n| Stack | DB | req/s | p50 ms | p95 ms | p99 ms | errors (timeouts) | non-2xx |\n|---|---|--:|--:|--:|--:|--:|--:|`);
  for (const d of dbs) for (const s of stacks) { const r = get(s, d, e); if (!r) continue;
    const z = r.s2xx === 0; const f = (v) => z ? '—' : v;
    console.log(`| ${name[s]} | ${d === 'pg' ? 'Postgres' : 'SQLite'} | ${r.s2xx ? Math.round(r.s2xx / r.duration) : 0} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${r.errors} (${r.timeouts}) | ${r.non2xx} |`); }
}
console.log('\n### Peak server RSS (VmHWM, MB; max over the endpoint runs; DB server memory not included)\n\n| Stack | SQLite list | SQLite summary | SQLite post | PG list | PG summary | PG post |\n|---|--:|--:|--:|--:|--:|--:|');
for (const s of stacks) { const c = []; for (const d of dbs) for (const e of ['list', 'summary', 'post']) { const r = get(s, d, e); c.push(r ? (r.rssKB / 1024).toFixed(0) : 'n/a'); } console.log(`| ${name[s]} | ${c.join(' | ')} |`); }
