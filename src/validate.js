// @ts-check
'use strict';
const { bad } = require('./errors');

function int(v, name, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return undefined; throw bad('VALIDATION', `${name} is required`); }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw bad('VALIDATION', `${name} must be an integer`);
  if (v < min || v > max) throw bad('VALIDATION', `${name} must be between ${min} and ${max}`);
  return v;
}
function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return undefined; throw bad('VALIDATION', `${name} is required`); }
  if (typeof v !== 'string') throw bad('VALIDATION', `${name} must be text`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad('VALIDATION', `${name} must be ${min}-${max} characters`);
  return s;
}
function oneOf(v, name, list, { optional = false } = {}) {
  if ((v === undefined || v === null) && optional) return undefined;
  if (!list.includes(v)) throw bad('VALIDATION', `${name} must be one of: ${list.join(', ')}`);
  return v;
}
function date(v, name, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) ||
      new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw bad('VALIDATION', `${name} must be a valid YYYY-MM-DD date`);
  return v;
}
function email(v) {
  const s = str(v, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('VALIDATION', 'email is not valid');
  return s;
}
function bool(v) { return v === true || v === 1 || v === '1'; }
function obj(v, name) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('VALIDATION', `${name} must be an object`); return v; }

module.exports = { int, str, oneOf, date, email, bool, obj };
