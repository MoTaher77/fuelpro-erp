import { bad } from './errors.ts';
type Opt = { min?: number; max?: number; optional?: boolean };
const empty = (v: unknown) => v === undefined || v === null || v === '';
export function int(v: unknown, name: string, o: Opt & { optional: true }): number | undefined;
export function int(v: unknown, name: string, o?: Opt): number;
export function int(v: unknown, name: string, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false }: Opt = {}): number | undefined {
  if (empty(v)) { if (optional) return undefined; throw bad('VALIDATION', `${name} is required`); }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw bad('VALIDATION', `${name} must be an integer`);
  if (v < min || v > max) throw bad('VALIDATION', `${name} must be between ${min} and ${max}`);
  return v;
}
export function str(v: unknown, name: string, o: Opt & { optional: true }): string | undefined;
export function str(v: unknown, name: string, o?: Opt): string;
export function str(v: unknown, name: string, { min = 1, max = 200, optional = false }: Opt = {}): string | undefined {
  if (empty(v)) { if (optional) return undefined; throw bad('VALIDATION', `${name} is required`); }
  if (typeof v !== 'string') throw bad('VALIDATION', `${name} must be text`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad('VALIDATION', `${name} must be ${min}-${max} characters`);
  return s;
}
export function oneOf<T extends string>(v: unknown, name: string, list: readonly T[]): T {
  if (!list.includes(v as T)) throw bad('VALIDATION', `${name} must be one of: ${list.join(', ')}`);
  return v as T;
}
export function date(v: unknown, name: string): string | undefined {
  if (empty(v)) return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) ||
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw bad('VALIDATION', `${name} must be a valid YYYY-MM-DD date`);
  return v;
}
export function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('VALIDATION', `${name} must be an object`);
  return v as Record<string, unknown>;
}
export const bool = (v: unknown) => v === true || v === 1 || v === '1';
