'use strict';
// Consistent online backup: npm run backup  (writes data/backups/fuelpro-YYYYMMDD-HHMMSS.db)
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const src = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fuelpro.db');
const dir = path.join(path.dirname(src), 'backups'); fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/^(\d{8})/, '$1-');
const dest = path.join(dir, `fuelpro-${stamp}.db`);
const db = new DatabaseSync(src); db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); db.close();
console.log('Backup written:', dest);
