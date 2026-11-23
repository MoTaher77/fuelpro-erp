'use strict';
/* The dependency-free .xlsx writer used by the «⇩ Excel» button: a valid ZIP, the right parts, numbers stay numbers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../public/xlsx.js');

/* read back a stored ZIP: name -> text, checking every CRC */
function unzip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const out = {};
  let end = b.length - 22; while (dv.getUint32(end, true) !== 0x06054b50) end--;
  let p = dv.getUint32(end + 16, true); const n = dv.getUint16(end + 10, true);
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const data = b.subarray(off + 30 + dv.getUint16(off + 26, true), off + 30 + dv.getUint16(off + 26, true) + size);
    assert.equal(X.crc32(data), crc, 'crc of ' + name);
    out[name] = new TextDecoder().decode(data); p += 46 + nl;
  }
  return out;
}

test('cellValue turns formatted numbers into numbers and leaves text, dates and percentages alone', () => {
  assert.equal(X.cellValue('1,256,929,449'), 1256929449); assert.equal(X.cellValue('(1,200.50)'), -1200.5); assert.equal(X.cellValue('-0.25'), -0.25);
  assert.equal(X.cellValue('١٢٣٫٥'), 123.5); assert.equal(X.cellValue('5.5%'), '5.5%'); assert.equal(X.cellValue('2026/01/31'), '2026/01/31');
  assert.equal(X.cellValue('بترول'), 'بترول'); assert.equal(X.cellValue(''), null);
});

test('build writes a workbook Excel can open: parts, sheets, header style, RTL, escaped text', () => {
  const bytes = X.build({ title: 'تقرير', sheets: [
    { name: 'المبيعات/اليومية', header: 1, rtl: true, rows: [['الوقود', 'اللترات', 'المبلغ'], ['بترول <A&B>', 1460484, 709365760.5], [null, 2, 3]] },
    { name: 'المبيعات/اليومية', rows: [['x']] }] });
  const f = unzip(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml']) assert.ok(f[part], part);
  assert.match(f['xl/workbook.xml'], /name="المبيعات اليومية"/); assert.match(f['xl/workbook.xml'], /name="المبيعات اليومية 2"/, 'sheet names are unique');
  const s1 = f['xl/worksheets/sheet1.xml'];
  assert.match(s1, /rightToLeft="1"/); assert.match(s1, /state="frozen"/);
  assert.match(s1, /<c r="A1" t="inlineStr" s="1">/); assert.match(s1, /<c r="B2" s="3"><v>1460484<\/v><\/c>/); assert.match(s1, /<c r="C2" s="2"><v>709365760.5<\/v><\/c>/);
  assert.match(s1, /بترول &lt;A&amp;B&gt;/); assert.ok(!/r="A3"/.test(s1), 'empty cells are skipped');
});
