'use strict';
// autocannon wrapper that also records p95 (autocannon's CLI only prints p97.5).
// node load.js <url> <durationSec> <connections> [POST body]   (env TIMEOUT = per-request timeout s, default 10)
const autocannon = require('autocannon');
const hdr = require('hdr-histogram-js');
const [url, dur, conn, body] = process.argv.slice(2);
const h = hdr.build({ lowestDiscernibleValue: 1, highestTrackableValue: 120000 * 1000, numberOfSignificantValueDigits: 3 }); // microseconds
const opts = { url, duration: Number(dur), connections: Number(conn), headers: { 'X-Org': '1', 'content-type': 'application/json' }, timeout: Number(process.env.TIMEOUT || 10) };
if (body) { opts.method = 'POST'; opts.body = body; }
const inst = autocannon(opts, (err, r) => {
  if (err) throw err;
  const q = (p) => +(h.getValueAtPercentile(p) / 1000).toFixed(2);
  console.log(JSON.stringify({ rps: Math.round(r.requests.total / r.duration), total: r.requests.total, duration: r.duration,
    p50: q(50), p95: q(95), p99: q(99), max: q(100), errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx,
    s2xx: r['2xx'], ac_p50: r.latency.p50, ac_p99: r.latency.p99 }));
});
inst.on('response', (c, code, bytes, rt) => { h.recordValue(Math.max(1, Math.round(rt * 1000))); });
