/* FuelPro v2 — server edition (phase 1: sales & shifts). PostgreSQL when V2_DB is a postgres:// URL, otherwise a
   SQLite file. Serves the shared UI and the core's operation table at /api/v2.
   Sign-in (passkeys + TOTP, ADR-37) comes with the users module; until then one bearer token guards the API and the
   server listens on 127.0.0.1 only. Never put real station data in a phase-1 server. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, setup, type Ctx } from '@fuelpro/core';
import { openPostgres, openSqlite } from '@fuelpro/db';

const dir = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const SEC = {
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
};

export async function openFromEnv(spec = process.env.V2_DB || './v2-data/fuelpro-v2.db'): Promise<Ctx & { close(): Promise<void> }> {
  if (/^postgres(ql)?:\/\//.test(spec)) return openPostgres(spec, { max: Number(process.env.V2_PG_POOL || 20) });
  if (spec !== ':memory:') { const { mkdirSync } = await import('node:fs'); mkdirSync(join(spec, '..'), { recursive: true }); }
  return openSqlite(spec);
}

export function createServer(ctx: Ctx, token: string) {
  const tok = Buffer.from(token);
  const authed = (req: http.IncomingMessage) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return false;
    const b = Buffer.from(m[1]); return b.length === tok.length && timingSafeEqual(b, tok);
  };
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC }); res.end(s);
  };
  const readBody = (req: http.IncomingMessage) => new Promise<unknown>((ok, fail) => {
    let n = 0; const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => { n += c.length; if (n > 64 * 1024) { fail({ status: 413, code: 'TOO_LARGE' }); req.destroy(); } else parts.push(c); });
    req.on('end', () => { if (!n) return ok({}); try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { fail({ status: 400, code: 'BAD_JSON' }); } });
    req.on('error', fail);
  });
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    try {
      if (url.pathname.startsWith('/api/v2/')) {
        if (!authed(req)) return send(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
        const path = url.pathname.slice('/api/v2'.length), method = req.method || 'GET';
        const body = method === 'GET' ? {} : await readBody(req);
        if (path === '/state') { const o = await setup.firstOwner(ctx); return send(res, 200, { station_id: o ? o.station_id : null }); }
        if (path === '/first-run' && method === 'POST') return send(res, 200, await setup.firstRun(ctx, body as Record<string, unknown>));
        const owner = await setup.firstOwner(ctx);
        if (!owner) return send(res, 409, { error: { code: 'NOT_SET_UP', message: 'Run the first-run setup first' } });
        const out = await api.call(ctx, owner, method, path, body, Object.fromEntries(url.searchParams));
        return send(res, 200, out ?? null);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { code: 'METHOD', message: 'Method not allowed' } });
      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(dir, rel);
      if (!file.startsWith(dir)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      const data = await readFile(file).catch(() => null);
      if (!data) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': rel === '/index.html' ? 'no-cache' : 'public, max-age=86400', ...SEC });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      const x = e as { status?: number; code?: string };
      if (x && x.status && x.code && !(e instanceof Error)) return send(res, x.status, { error: { code: x.code, message: x.code } });
      const { status, body } = api.errorBody(e);
      if (status === 500) console.error('[v2]', e);
      send(res, status, body);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = await openFromEnv();
  const token = process.env.V2_TOKEN || randomBytes(18).toString('base64url');
  const port = Number(process.env.PORT || 3100), host = process.env.HOST || '127.0.0.1';
  createServer(ctx, token).listen(port, host, () => {
    console.log(`FuelPro v2 (${ctx.dialect}) on http://${host}:${port}/#t=${process.env.V2_TOKEN ? '<V2_TOKEN>' : token}`);
  });
}
