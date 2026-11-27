/* Builds the shared UI for each edition: apps/<edition>/web/main.ts → apps/<edition>/dist (app.js, app.css, fonts, index.html).
   esbuild, one file per edition, no runtime CDN. Usage: node tools/build.ts [server|desktop|mobile ...] */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const editions = process.argv.slice(2).length ? process.argv.slice(2) : ['server', 'desktop', 'mobile'];
const report: Record<string, unknown> = {};
for (const ed of editions) {
  const app = join(root, 'apps', ed), out = join(app, 'dist');
  mkdirSync(join(out, 'fonts'), { recursive: true });
  const t0 = performance.now();
  const res = await build({ metafile: true, entryPoints: [join(app, 'web/main.ts')], bundle: true, format: 'esm', target: ['es2022', 'chrome100', 'safari15'], platform: 'browser',
    minify: true, sourcemap: false, legalComments: 'none', outdir: out, entryNames: 'app', chunkNames: 'chunks/[name]-[hash]', splitting: true, logLevel: 'warning' });
  cpSync(join(root, 'packages/ui/src/style.css'), join(out, 'app.css'));
  for (const f of ['ibm-plex-sans-arabic-arabic-400-normal.woff2', 'ibm-plex-sans-arabic-arabic-600-normal.woff2', 'ibm-plex-sans-arabic-latin-400-normal.woff2', 'ibm-plex-sans-arabic-latin-600-normal.woff2', 'LICENSE-ibm-plex-sans-arabic.txt']) cpSync(join(root, '../public/fonts', f), join(out, 'fonts', f));
  // the files the first screen needs (app.js + its static imports) are preloaded in parallel; lazy screens are not
  const meta = res.metafile!.outputs, entryKey = Object.keys(meta).find((k) => k.endsWith('/app.js'))!;
  const first = [entryKey, ...meta[entryKey].imports.filter((i) => i.kind === 'import-statement').map((i) => i.path)];
  const rel = (k: string) => k.slice(k.indexOf('/dist/') + 6);
  const preload = first.slice(1).map((k) => `<link rel="modulepreload" href="${rel(k)}">`).join('\n');
  writeFileSync(join(out, 'index.html'), readFileSync(join(app, 'web/index.html'), 'utf8').replace('<script type="module"', preload + (preload ? '\n' : '') + '<script type="module"'));
  const js = Buffer.concat(first.map((k) => readFileSync(join(root, k.startsWith('/') ? k.slice(root.length) : k))));
  report[ed] = { ms: Math.round(performance.now() - t0), js_kb: +(js.length / 1024).toFixed(1), js_gzip_kb: +(gzipSync(js).length / 1024).toFixed(1),
    total_kb: +(readdirSync(out, { recursive: true }).map((f) => statSync(join(out, String(f)))).filter((s) => s.isFile()).reduce((a, s) => a + s.size, 0) / 1024).toFixed(1) };
}
writeFileSync(join(root, 'tools/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
