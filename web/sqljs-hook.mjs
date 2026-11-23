/* Run Node tests or scripts with node:sqlite replaced by sql.js (the engine the Artifact edition uses):
     node --import ./web/sqljs-hook.mjs --test test/*.test.js
   Needs the sql.js package (CI: `npm i --no-save sql.js@1.10.3`). Node's own crypto/Buffer stay; only the SQLite engine
   changes, so a green run proves the SQL in src/ behaves the same on the page's engine. Every database starts empty in memory. */
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SQL = await require('sql.js/dist/sql-asm-memory-growth.js')();
require('./shims/sqlite-sqljs.js');
const engine = globalThis.FP_makeSqlite(SQL);
import fs from 'node:fs';
/* a file path behaves like a file: read when it exists, written back on close (the page keeps bytes in Artifact storage instead) */
class DatabaseSync {
  constructor(file) {
    const disk = file && file !== ':memory:' ? String(file) : null;
    globalThis.__FP_DB_BYTES = disk && fs.existsSync(disk) && fs.statSync(disk).size ? fs.readFileSync(disk) : null;
    const d = new engine.DatabaseSync(); globalThis.__FP_DB_BYTES = null;
    if (disk) { const close = d.close.bind(d); d.close = () => { fs.writeFileSync(disk, d.bytes()); close(); }; }
    return d;
  }
}
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node:sqlite' || request === 'sqlite') return { DatabaseSync };
  return load.call(this, request, ...rest);
};
