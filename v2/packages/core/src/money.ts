/* All money is an integer in the currency's minor unit; volume is integer millilitres; unit prices are
   "minor units per litre x 10,000" (price_e4). Products go through BigInt: no float drift, no overflow at 2^53.
   Same rules and same rounding as v1 src/money.js (round half away from zero). */
export function divRound(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (2n * ad);
  return neg ? -q : q;
}
export function currencyDecimals(code: string): number | null {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? null; }
  catch { return null; }
}
/** amount in minor units for `qtyMl` millilitres at `priceE4` */
export function amountMinor(qtyMl: number, priceE4: number): number {
  return Number(divRound(BigInt(qtyMl) * BigInt(priceE4), 10_000_000n));
}
const E7 = 10_000_000n;
/** value of `ml` millilitres at a unit cost `costE4` */
export const atCost = (ml: number, costE4: number): number => Number(divRound(BigInt(ml) * BigInt(costE4), E7));
/** average cost e4 of `value` spread over `ml` */
export const avgCost = (value: number, ml: number): number => Number(divRound(BigInt(value) * E7, BigInt(ml)));
/** Split an amount into net / vat / gross. rateBp: basis points (2000 = 20%). included: amount already contains VAT. */
export function vatSplit(amount: number, rateBp: number, included: boolean): { net: number; vat: number; gross: number } {
  if (!rateBp) return { net: amount, vat: 0, gross: amount };
  const a = BigInt(amount), r = BigInt(rateBp);
  if (included) { const vat = divRound(a * r, 10000n + r); return { net: Number(a - vat), vat: Number(vat), gross: amount }; }
  const vat = divRound(a * r, 10000n);
  return { net: amount, vat: Number(vat), gross: Number(a + vat) };
}
/** basis-point share of an amount, rounded half up (discount_bp) */
export const bpOf = (amount: number, bp: number): number => Number((BigInt(amount) * BigInt(bp) + 5000n) / 10000n);
