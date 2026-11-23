'use strict';
/* Minimal, dependency-free .xlsx writer (Office Open XML in a ZIP, stored entries + CRC-32).
   Works in the browser (window.FPXLSX) and in Node (module.exports) so it can be tested.
   build({ sheets: [{ name, rows: [[cell...]], header: n, widths: [chars...], rtl }] }) -> Uint8Array
   A cell is a number (written as a number), a string, or null. The first `header` rows are bold with a fill. */
(function (root) {
  const enc = (s) => new TextEncoder().encode(s);
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function zip(files) {                       // files: [{ name, data: Uint8Array }] -> stored ZIP
    const parts = [], central = []; let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = enc(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
      parts.push(local, f.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      offset += local.length + size;
    }
    const cdSize = central.reduce((t, c) => t + c.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((t, p) => t + p.length, 0)); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; } return out;
  }

  function sheetXml(sh) {
    const rows = sh.rows || [], header = sh.header || 0;
    const widths = sh.widths || (rows.length ? rows[0].map((_, j) => Math.min(Math.max(8, ...rows.slice(0, 200).map(r => typeof r[j] === 'number' ? Math.ceil(String(Math.trunc(Math.abs(r[j]))).length * 4 / 3) + 6 : String(r[j] ?? '').length + 2)), 60)) : []);
    const cols = widths.length ? `<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
      if (v == null || v === '') return '';
      const ref = colName(j) + (i + 1), st = i < header ? ' s="1"' : (typeof v === 'number' ? (Number.isInteger(v) ? ' s="3"' : ' s="2"') : '');
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const freeze = header ? `<sheetViews><sheetView workbookViewId="0"${sh.rtl ? ' rightToLeft="1"' : ''}><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"${sh.rtl ? ' rightToLeft="1"' : ''}/></sheetViews>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
  }

  function build({ sheets, title }) {
    if (!sheets || !sheets.length) throw new Error('No sheets');
    const used = new Set();
    const names = sheets.map((s, i) => { let n = String(s.name || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1); let k = 2, base = n.slice(0, 28);
      while (used.has(n.toLowerCase())) n = `${base} ${k++}`; used.add(n.toLowerCase()); return n; });
    const files = [
      { name: '[Content_Types].xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
      { name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>') },
      { name: 'docProps/core.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title || 'FuelPro')}</dc:title><dc:creator>FuelPro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`) },
      { name: 'xl/workbook.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      /* styles: 0 normal · 1 header (bold, fill, border) · 2 #,##0.00 · 3 #,##0 */
      { name: 'xl/styles.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDFF0E8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF0C6B55"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>') },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s)) }))
    ];
    return zip(files);
  }

  /* text of a table cell -> number when it is clearly one (thousand separators, Arabic digits, (negatives), %) */
  function cellValue(text) {
    const t = String(text || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,\s‎‏]/g, '').replace('٫', '.');
    const m = /^(\()?([-−–]?)(\d+(?:\.\d+)?)(\))?(%)?$/.exec(t);
    if (!m || (m[1] && !m[4])) return String(text || '').trim() || null;
    if (m[5]) return String(text).trim();          // percentages stay as written
    let v = Number(m[3]); if (m[2] || m[1]) v = -v; return v;
  }
  /* an HTML table -> rows (header rows first), honouring colspan */
  function tableRows(table) {
    const rows = [], head = table.tHead ? table.tHead.rows.length : 0;
    for (const tr of table.rows) { const r = []; for (const c of tr.cells) { if (c.closest('.noxl')) continue; const v = cellValue(c.innerText); r.push(tr.parentNode.tagName === 'THEAD' ? (c.innerText || '').trim() : v); for (let k = 1; k < (c.colSpan || 1); k++) r.push(null); } rows.push(r); }
    return { rows, header: head };
  }
  const api = { build, cellValue, tableRows, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FPXLSX = api;
})(typeof window !== 'undefined' ? window : globalThis);
