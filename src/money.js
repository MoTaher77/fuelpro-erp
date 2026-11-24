// @ts-check
'use strict';
/*
 * All money is an integer in the currency's minor unit (cents, fils, rials...).
 * All volume is an integer number of millilitres.
 * Unit prices are integers "minor units per litre x 10,000" (price_e4).
 * Example: 0.9137 USD/L = 91.37 cents/L -> price_e4 = 913,700.
 * Intermediate products use BigInt, so there is no floating-point drift and no
 * overflow at 2^53.
 */

function divRound(n, d) {            // round-half-away-from-zero integer division
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (2n * ad);
  return neg ? -q : q;
}

function currencyDecimals(code) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  } catch { return null; }
}

/** amount in minor units for `qtyMl` millilitres at `priceE4` (minor units per litre x 10^4) */
function amountMinor(qtyMl, priceE4) {
  return Number(divRound(BigInt(qtyMl) * BigInt(priceE4), 10_000_000n));
}

/**
 * Split an amount into net / vat / gross.
 * rateBp: VAT rate in basis points (2000 = 20%). included: amount already contains VAT.
 */
function vatSplit(amount, rateBp, included) {
  if (!rateBp) return { net: amount, vat: 0, gross: amount };
  const a = BigInt(amount), r = BigInt(rateBp);
  if (included) {
    const vat = divRound(a * r, 10000n + r);
    return { net: Number(a - vat), vat: Number(vat), gross: amount };
  }
  const vat = divRound(a * r, 10000n);
  return { net: amount, vat: Number(vat), gross: Number(a + vat) };
}

module.exports = { divRound, currencyDecimals, amountMinor, vatSplit };
