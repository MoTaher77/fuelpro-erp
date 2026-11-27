// Tiny static server: /<fw>/... -> <fw>/dist/..., gzip (level 9) for text assets, no caching.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = __dirname, TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const cache = new Map();
function serve(req, res) {
  const u = new URL(req.url, 'http://x'); const [, fw, ...rest] = u.pathname.split('/');
  const file = path.join(ROOT, fw || '', 'dist', rest.join('/') || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = cache.get(file); if (!body) { body = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); cache.set(file, body); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-encoding': 'gzip', 'cache-control': 'no-store', 'content-length': body.length });
  res.end(body);
}
module.exports = (port) => new Promise((r) => { const s = http.createServer(serve).listen(port, () => r(s)); });
if (require.main === module) module.exports(+process.argv[2] || 4173).then(() => console.log('listening'));
