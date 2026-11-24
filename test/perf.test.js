'use strict';
/* 0.26.0 speed work (docs/PERFORMANCE.md): app files are compressed and revalidated with an ETag, big API answers are gzip-compressed,
   and none of it changes what the client receives. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { createApp } = require('../src/server');

let base, server;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} } }); server = app.server;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(r => server.close(r)));

/* raw request, no automatic decompression, so the test sees exactly what travels on the wire */
const raw = (path, headers = {}, method = 'GET', body) => new Promise((resolve, reject) => {
  const r = http.request(base + path, { method, headers }, (res) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); });
  r.on('error', reject); if (body) r.write(body); r.end();
});

test('app files: brotli or gzip by Accept-Encoding, identical bytes once decoded, ETag + 304 on revalidation', async () => {
  const plain = await raw('/app.js');
  assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined);
  assert.match(plain.headers['cache-control'], /no-cache/);          // the browser still asks every time: a new version shows at once
  const etag = plain.headers.etag; assert.match(etag, /^"[\w-]{10,}"$/);
  const br = await raw('/app.js', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br'); assert.ok(br.body.length < plain.body.length / 3, 'brotli at least 3x smaller');
  assert.deepEqual(zlib.brotliDecompressSync(br.body), plain.body);
  const gz = await raw('/app.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.deepEqual(zlib.gunzipSync(gz.body), plain.body);
  assert.equal(br.headers.etag, etag); assert.equal(br.headers.vary, 'Accept-Encoding');
  const again = await raw('/app.js', { 'if-none-match': etag, 'accept-encoding': 'br' });
  assert.equal(again.status, 304); assert.equal(again.body.length, 0);
  const other = await raw('/app.js', { 'if-none-match': '"stale"' }); assert.equal(other.status, 200);
  assert.equal((await raw('/index.html')).headers['content-type'], 'text/html; charset=utf-8');
  assert.equal((await raw('/nope.js')).status, 404);
  assert.equal((await raw('/%E0%A4%A')).status, 400);                // a broken escape no longer throws inside the static handler
  assert.equal((await raw('/../package.json')).status, 404);          // normalised by URL parsing, never outside public/
});

test('API: big answers are gzip-compressed for clients that accept it, small ones and errors stay plain', async () => {
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_name: 'Org', name: 'Owner', email: 'perf@example.com', password: 'correct horse battery', station: { name: 'S1', currency: 'YER', timezone: 'Asia/Aden' } }) });
  assert.equal(reg.status, 201); const cookie = reg.headers.get('set-cookie').split(';')[0];
  const big = await raw('/api/accounts', { cookie, 'accept-encoding': 'gzip' });           // the chart of accounts is several KB
  assert.equal(big.status, 200); assert.equal(big.headers['content-encoding'], 'gzip'); assert.equal(big.headers['cache-control'], 'no-store');
  const decoded = JSON.parse(zlib.gunzipSync(big.body)); assert.ok(Array.isArray(decoded) && decoded.length > 20);
  const same = await raw('/api/accounts', { cookie });                                         // without Accept-Encoding: plain JSON, same content
  assert.equal(same.headers['content-encoding'], undefined); assert.deepEqual(JSON.parse(same.body), decoded);
  const small = await raw('/api/health', { 'accept-encoding': 'gzip' }); assert.equal(small.headers['content-encoding'], undefined);
  const err = await raw('/api/me', { 'accept-encoding': 'gzip' }); assert.equal(err.status, 401); assert.equal(err.headers['content-encoding'], undefined);
});

test('journal list pages in its own order: an entry typed later but dated earlier is not skipped between pages', async () => {
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_name: 'Org', name: 'Owner', email: 'paging@example.com', password: 'correct horse battery', station: { name: 'S1', currency: 'YER', timezone: 'Asia/Aden' } }) });
  const { station_id: sid } = await reg.json(); const cookie = reg.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) }); return r.json(); };
  const acct = await call('GET', '/api/accounts'); const A = (code) => acct.find(a => a.code === code).id;
  const today = new Date().toISOString().slice(0, 10), day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const made = [];
  for (const d of [day(1), day(1), today, today, day(5)]) {   // the last one is typed last (largest id) but dated earliest
    made.push((await call('POST', `/api/stations/${sid}/journals`, { date: d, memo: 'paging test', post: true, lines: [{ account_id: A('6050'), debit: 100 }, { account_id: A('1010'), credit: 100 }] })).id);
  }
  const seen = []; let before = '';
  for (;;) { const page = await call('GET', `/api/stations/${sid}/journals?status=posted&limit=2${before}`); seen.push(...page); if (page.length < 2) break; before = '&before_id=' + page[page.length - 1].id; }
  assert.deepEqual(seen.map(j => j.id).sort((a, b) => a - b), made.sort((a, b) => a - b), 'every journal exactly once');
  const dates = seen.map(j => j.business_date); assert.deepEqual(dates, [...dates].sort().reverse(), 'newest date first across pages');
});

test('index.html names each app file with its content hash; that exact URL is cached as immutable, others are revalidated', async () => {
  const page = await raw('/');
  assert.equal(page.status, 200); assert.match(page.headers['cache-control'], /no-cache/);
  const html = page.body.toString('utf8');
  const m = /src="\/app\.js\?v=([\w-]+)"/.exec(html); assert.ok(m, 'versioned app.js in index.html');
  assert.match(html, /href="\/app\.css\?v=[\w-]+"/);
  const cur = await raw('/app.js?v=' + m[1]);
  assert.equal(cur.status, 200); assert.match(cur.headers['cache-control'], /immutable/);
  assert.equal(cur.headers.etag, '"' + m[1] + '"');
  const stale = await raw('/app.js?v=not-this-one'); assert.equal(stale.headers['cache-control'], 'no-cache');
  assert.deepEqual(stale.body, cur.body);                                                   // same current file either way
  const again = await raw('/', { 'if-none-match': page.headers.etag }); assert.equal(again.status, 304);
});
