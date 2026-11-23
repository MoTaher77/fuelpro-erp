'use strict';
/* SQLite -> PostgreSQL translation for the statements FuelPro sends at run time (Phase 2). Pure functions, unit-tested.
   Placeholders and a few functions are rewritten; string literals are never touched. */

/** apply fn to the parts of the SQL that are outside '...' string literals and "..." identifiers */
function outsideQuotes(sql, fn) {
  let out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') { let j = i + 1; while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; } out += sql.slice(i, j + 1); i = j + 1; }
    else { let j = i; while (j < sql.length && sql[j] !== "'" && sql[j] !== '"') j++; out += fn(sql.slice(i, j)); i = j; }
  }
  return out;
}
const NOW = "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')";
const TODAY = "to_char(now() at time zone 'utc', 'YYYY-MM-DD')";

function translate(sql) {
  let n = 0;
  /* functions whose argument is itself a quoted word are replaced on the whole text first */
  let s = sql.replace(/\bdatetime\(\s*'now'\s*\)/gi, '\u0000NOW\u0000').replace(/\bdate\(\s*'now'\s*\)/gi, '\u0000TODAY\u0000');
  s = outsideQuotes(s, (p) => p
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, '\u0000IGNORE\u0000INSERT INTO')
    .replace(/\bGROUP_CONCAT\(/gi, 'string_agg(')
    .replace(/\?/g, () => '$' + (++n)));
  s = s.replace(/\u0000NOW\u0000/g, NOW).replace(/\u0000TODAY\u0000/g, TODAY);
  if (s.includes('\u0000IGNORE\u0000')) { s = s.replace('\u0000IGNORE\u0000', '').trimEnd().replace(/;$/, ''); if (!/ON\s+CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING'; }
  return { sql: s, params: n };
}
/** statements with no meaning on PostgreSQL (SQLite pragmas); BEGIN IMMEDIATE is a plain BEGIN */
function isNoop(sql) { return /^\s*PRAGMA\b/i.test(sql); }
function simple(sql) { return sql.replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'BEGIN').replace(/\bPRAGMA\b[^;]*;?/gi, ''); }
/** the table an INSERT writes into, or null */
function insertTable(sql) { const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([a-z_][a-z0-9_]*)"?/i.exec(sql); return m ? m[1].toLowerCase() : null; }

module.exports = { translate, isNoop, simple, insertTable, outsideQuotes };
