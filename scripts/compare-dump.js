'use strict';
/* Proves an optimisation changed nothing a user can see: compares two --dump files of scripts/bench-api.js
   (before and after) response by response and prints the first difference of each endpoint.
   Usage: node scripts/compare-dump.js before.json after.json   (exit code 1 when anything differs) */
const fs = require('fs');
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const diff = (x, y, p) => {
  if (x === y) return null;
  if (typeof x !== typeof y || x === null || y === null || typeof x !== 'object') return `${p}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`;
  if (Array.isArray(x) !== Array.isArray(y)) return `${p}: array vs object`;
  if (Array.isArray(x) && x.length !== y.length) return `${p}: length ${x.length} ≠ ${y.length}`;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = diff(x[k], y[k], `${p}.${k}`); if (d) return d; }
  return null;
};
let bad = 0;
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  const d = diff(a[k], b[k], k);
  if (d) { bad++; console.log('DIFF ' + d); } else console.log('same ' + k);
}
console.log(bad ? `${bad} endpoint(s) differ` : 'all responses identical');
process.exit(bad ? 1 : 0);
