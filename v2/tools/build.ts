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
  await build({ entryPoints: [join(app, 'web/main.ts')], bundle: true, format: 'esm', target: ['es2022', 'chrome100', 'safari15'], platform: 'browser',
    minify: true, sourcemap: false, legalComments: 'none', outfile: join(out, 'app.js'), logLevel: 'warning' });
  cpSync(join(root, 'packages/ui/src/style.css'), join(out, 'app.css'));
  for (const f of ['ibm-plex-sans-arabic-arabic-400-normal.woff2', 'ibm-plex-sans-arabic-arabic-600-normal.woff2', 'ibm-plex-sans-arabic-latin-400-normal.woff2', 'ibm-plex-sans-arabic-latin-600-normal.woff2', 'LICENSE-ibm-plex-sans-arabic.txt']) cpSync(join(root, '../public/fonts', f), join(out, 'fonts', f));
  cpSync(join(app, 'web/index.html'), join(out, 'index.html'));
  const js = readFileSync(join(out, 'app.js'));
  report[ed] = { ms: Math.round(performance.now() - t0), js_kb: +(js.length / 1024).toFixed(1), js_gzip_kb: +(gzipSync(js).length / 1024).toFixed(1),
    total_kb: +(readdirSync(out, { recursive: true }).map((f) => statSync(join(out, String(f)))).filter((s) => s.isFile()).reduce((a, s) => a + s.size, 0) / 1024).toFixed(1) };
}
writeFileSync(join(root, 'tools/build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
