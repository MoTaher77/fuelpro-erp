'use strict';
const http = require('node:http');
const { store, HttpErr, orgOf } = require('../node-common/core.js');
const send = (res, s, o) => { const b = JSON.stringify(o); res.writeHead(s, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
const RE = /^\/stations\/(\d+)\/(sales|summary)$/;
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'); const m = RE.exec(u.pathname); if (!m) throw new HttpErr(404, 'not found');
    const org = orgOf(req.headers['x-org']), sid = Number(m[1]);
    if (req.method === 'GET' && m[2] === 'sales') return send(res, 200, await store.list(org, sid, Math.min(Number(u.searchParams.get('limit')) || 50, 200)));
    if (req.method === 'GET' && m[2] === 'summary') return send(res, 200, await store.summary(org, sid, u.searchParams.get('day')));
    if (req.method === 'POST' && m[2] === 'sales') {
      let raw = ''; for await (const c of req) raw += c; let b; try { b = JSON.parse(raw); } catch { throw new HttpErr(400, 'json'); }
      return send(res, 201, await store.create(org, sid, b));
    }
    throw new HttpErr(405, 'method');
  } catch (e) { send(res, e.status || 500, { error: e.message }); }
}).listen(Number(process.env.PORT || 8080), '127.0.0.1');
