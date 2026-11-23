'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { amountMinor, vatSplit, divRound, currencyDecimals } = require('../src/money');

test('divRound rounds half away from zero', () => {
  assert.equal(divRound(5n, 2n), 3n); assert.equal(divRound(-5n, 2n), -3n);
  assert.equal(divRound(4n, 3n), 1n); assert.equal(divRound(5n, 3n), 2n);
});
test('amountMinor: 150.5 L at 0.9137/L (USD cents) = 137.51 USD', () => {
  // price_e4 = 0.9137 * 100 * 10000 = 913700 ; qty = 150500 ml ; amount = 13751 cents (13750.9... rounds)
  assert.equal(amountMinor(150500, 913700), 13751);
});
test('amountMinor with 0-decimal currency (YER)', () => {
  // 1,200 YER/L, price_e4 = 1200 * 1 * 10000 = 12,000,000 ; 150 L = 150000 ml -> 180,000 YER
  assert.equal(amountMinor(150000, 12_000_000), 180000);
});
test('amountMinor stays exact at the largest allowed inputs (no float drift, no overflow)', () => {
  // 5,000 L at 999,999,999.9999 minor units/L cannot be represented exactly as a double product; BigInt keeps it exact
  assert.equal(amountMinor(5_000_000, 10 ** 12), 5_000_000 * 10 ** 5);   // 5,000 L x 10^8 minor/L = 5 x 10^11
});
test('vatSplit included: 120.00 at 20% => net 100.00 vat 20.00', () => {
  assert.deepEqual(vatSplit(12000, 2000, true), { net: 10000, vat: 2000, gross: 12000 });
});
test('vatSplit excluded: 100.00 at 20% => gross 120.00', () => {
  assert.deepEqual(vatSplit(10000, 2000, false), { net: 10000, vat: 2000, gross: 12000 });
});
test('vatSplit always satisfies net + vat = gross', () => {
  for (let a = 1; a < 5000; a += 7) for (const r of [500, 1500, 1700, 2000, 2500]) for (const inc of [true, false]) {
    const s = vatSplit(a, r, inc); assert.equal(s.net + s.vat, s.gross);
  }
});
test('vatSplit zero rate', () => assert.deepEqual(vatSplit(999, 0, true), { net: 999, vat: 0, gross: 999 }));
test('currency decimals', () => { assert.equal(currencyDecimals('USD'), 2); assert.equal(currencyDecimals('KWD'), 3); assert.equal(currencyDecimals('JPY'), 0); assert.equal(currencyDecimals('XX'), null); });
