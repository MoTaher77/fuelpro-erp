/* Display and input of integers in minor units / millilitres, without floating point. Latin digits, grouped. */
export function fmtMinor(v: number, curDec: number, dispDec: number | null = null): string {
  const d = dispDec ?? curDec, neg = v < 0;
  let a = BigInt(Math.abs(v));
  if (d < curDec) { const f = 10n ** BigInt(curDec - d); a = (a * 2n + f) / (2n * f); }    // round half up to the shown decimals
  else if (d > curDec) a *= 10n ** BigInt(d - curDec);
  const s = a.toString().padStart(d + 1, '0');
  const int = BigInt(s.slice(0, s.length - d)).toLocaleString('en-US'), frac = d ? '.' + s.slice(-d) : '';
  return (neg ? '-' : '') + int + frac;
}
export const fmtLitres = (ml: number) => fmtMinor(ml, 3, 2);
/** "12.345" → 12345 when dec = 3. Accepts Arabic-Indic digits and ٫ , as decimal marks. Null if not a valid amount. */
export function parseDec(text: string, dec: number): number | null {
  const t = text.trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[٫,]/g, '.').replace(/[\s٬]/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(t); if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > dec && /[1-9]/.test(frac.slice(dec))) return null;
  const v = BigInt(m[1] + frac.slice(0, dec).padEnd(dec, '0'));
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
}
