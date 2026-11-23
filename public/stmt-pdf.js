'use strict';
/* FuelPro — account statement as a PDF file, made in the browser (no server, no library).
   Each A4 page is drawn on a canvas (the browser shapes Arabic and lays out right-to-left itself), saved as JPEG,
   and the pages are wrapped in a minimal PDF. Used to send a statement to WhatsApp as a file (0.16).
   window.FPPDF.statement(doc) -> Promise<Blob>, where doc = {
     brand:{name,activity,phones,address,logo}, title, period:[from,to], party:{name,ref,currency},
     summary:[{k,v,main?}], cols:[{k,w,num?}], rows:[[cells]], total:[cells], words, note, stamp } */
(function () {
  const W = 1240, H = 1754, M = 64;                     // A4 at 150 dpi, page margin
  const C = { green: '#0b5a44', gold: '#c9a043', ink: '#151a18', muted: '#5d6662', line: '#c9d5cf', zebra: '#f3f7f5', soft: '#fbf3dc', white: '#ffffff' };
  const FONT = "'Dubai','Segoe UI','Noto Naskh Arabic','Noto Sans Arabic',Tahoma,Arial,sans-serif";
  const f = (px, w) => `${w || 600} ${px}px ${FONT}`;

  function fit(ctx, text, max) {                        // shorten with … until it fits the column
    text = String(text ?? ''); if (ctx.measureText(text).width <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo) + '…';
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const loadImg = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

  function newPage() {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
    ctx.direction = 'rtl'; ctx.textBaseline = 'middle'; return { cv, ctx };
  }

  /* the full head (first page): letterhead, title band, party box, summary tiles. Returns the y where the table starts. */
  function head(ctx, d, logo) {
    const R = W - M; let y = M;
    if (logo) { const s = 96, r = Math.min(s / logo.width, s / logo.height); ctx.drawImage(logo, R - logo.width * r, y, logo.width * r, logo.height * r); }
    const tx = logo ? R - 112 : R;
    ctx.textAlign = 'right'; ctx.fillStyle = C.green; ctx.font = f(40, 800); ctx.fillText(fit(ctx, d.brand.name || '', 620), tx, y + 30);
    if (d.brand.activity) { ctx.fillStyle = '#8a611a'; ctx.font = f(22, 700); ctx.fillText(fit(ctx, d.brand.activity, 620), tx, y + 74); }
    ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = f(20, 500);
    if (d.brand.address) ctx.fillText(fit(ctx, d.brand.address, 420), M, y + 30);
    if (d.brand.phones) { ctx.direction = 'ltr'; ctx.fillText(fit(ctx, '☎ ' + d.brand.phones, 420), M, y + 66); ctx.direction = 'rtl'; }
    y += 116;
    ctx.fillStyle = C.green; ctx.fillRect(M, y, (W - 2 * M) * 0.66, 7); ctx.fillStyle = C.gold; ctx.fillRect(M + (W - 2 * M) * 0.66, y, (W - 2 * M) * 0.34, 7);
    y += 34;
    /* title ribbon + period */
    ctx.font = f(32, 800); const tw = ctx.measureText(d.title).width + 80, tx2 = (W - tw) / 2;
    rrect(ctx, tx2, y, tw, 60, 14); ctx.fillStyle = C.green; ctx.fill(); ctx.fillStyle = C.gold; ctx.fillRect(tx2 + 14, y + 56, tw - 28, 4);
    ctx.textAlign = 'center'; ctx.fillStyle = C.white; ctx.fillText(d.title, W / 2, y + 30);
    ctx.fillStyle = C.muted; ctx.font = f(21, 600); ctx.fillText(d.periodText, W / 2, y + 88);
    y += 120;
    /* party box */
    rrect(ctx, M, y, W - 2 * M, 104, 14); ctx.fillStyle = '#f6fbf8'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = C.green; ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillStyle = C.green; ctx.font = f(19, 700); ctx.fillText(d.labels.party, R - 24, y + 28);
    ctx.fillStyle = C.ink; ctx.font = f(31, 800); ctx.fillText(fit(ctx, d.party.name, 640), R - 24, y + 70);
    ctx.textAlign = 'left'; ctx.fillStyle = C.green; ctx.font = f(19, 700); ctx.fillText(d.labels.acct + ' / ' + d.labels.currency, M + 24, y + 28);
    ctx.fillStyle = C.ink; ctx.font = f(25, 700); ctx.direction = 'ltr'; ctx.fillText(`${d.party.ref || ''}`, M + 24, y + 70); ctx.direction = 'rtl';
    ctx.textAlign = 'left'; ctx.fillText(d.party.currency || '', M + 24 + 150, y + 70);
    y += 128;
    /* summary tiles */
    const n = d.summary.length, gap = 16, tile = (W - 2 * M - gap * (n - 1)) / n;
    d.summary.forEach((s, i) => {
      const x = W - M - (i + 1) * tile - i * gap;
      rrect(ctx, x, y, tile, 92, 12); ctx.fillStyle = s.main ? C.green : (i === 0 ? '#fdf8ea' : C.white); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = s.main ? C.green : (i === 0 ? C.gold : C.green); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillStyle = s.main ? '#d7ebe2' : C.muted; ctx.font = f(18, 600); ctx.fillText(s.k, x + tile - 18, y + 26);
      ctx.fillStyle = s.main ? C.white : C.ink; ctx.font = f(27, 800); ctx.fillText(fit(ctx, s.v, tile - 30), x + tile - 18, y + 64);
    });
    return y + 120;
  }

  /* the slim head of the following pages */
  function runHead(ctx, d, page) {
    ctx.textAlign = 'right'; ctx.fillStyle = C.green; ctx.font = f(22, 800); ctx.fillText(fit(ctx, `${d.brand.name || ''} · ${d.title}`, 760), W - M, M + 14);
    ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = f(20, 600); ctx.fillText(fit(ctx, d.party.name, 360), M, M + 14);
    ctx.fillStyle = C.gold; ctx.fillRect(M, M + 36, W - 2 * M, 3);
    return M + 60;
  }

  function colX(d) {                                     // right-to-left column positions from relative widths
    const total = d.cols.reduce((s, c) => s + c.w, 0), span = W - 2 * M; let x = W - M;
    return d.cols.map(c => { const w = span * c.w / total; const r = { right: x, left: x - w, w }; x -= w; return r; });
  }
  function tableHead(ctx, d, xs, y) {
    ctx.fillStyle = C.green; ctx.fillRect(M, y, W - 2 * M, 48);
    ctx.fillStyle = C.white; ctx.font = f(19, 800);
    d.cols.forEach((c, i) => { const p = xs[i]; ctx.textAlign = 'center'; ctx.fillText(fit(ctx, c.k, p.w - 12), (p.left + p.right) / 2, y + 24); });
    return y + 48;
  }
  function row(ctx, d, xs, y, cells, opt = {}) {
    const h = opt.h || 42;
    if (opt.fill) { ctx.fillStyle = opt.fill; ctx.fillRect(M, y, W - 2 * M, h); }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + h); ctx.lineTo(W - M, y + h); ctx.stroke();
    /* light column rules so the eye follows each column */
    ctx.strokeStyle = '#e3ebe7'; ctx.beginPath(); xs.slice(1).forEach(p => { ctx.moveTo(p.right, y + 6); ctx.lineTo(p.right, y + h - 6); }); ctx.stroke();
    cells.forEach((v, i) => {
      const c = d.cols[i], p = xs[i]; if (v == null || v === '') return;
      const cell = typeof v === 'object' ? v : { t: v };
      ctx.font = f(c.num ? 20 : 19, opt.bold || c.bold ? 800 : 600); ctx.fillStyle = opt.color && opt.color[i] ? opt.color[i] : C.ink;
      if (c.num) {
        /* amounts: one right edge per column so the digits line up; Dr/Cr as a small badge on the other side */
        let room = p.w - 24;
        if (cell.pill) {
          ctx.font = f(15, 800); const pw = ctx.measureText(cell.pill).width + 16, px = p.left + 8, py = y + h / 2 - 12;
          rrect(ctx, px, py, pw, 24, 7); ctx.fillStyle = cell.kind === 'cr' ? '#e1efe8' : '#fbecd2'; ctx.fill();
          ctx.fillStyle = cell.kind === 'cr' ? C.green : '#8a4b00'; ctx.textAlign = 'center'; ctx.fillText(cell.pill, px + pw / 2, y + h / 2 + 1);
          room -= pw + 8; ctx.font = f(20, opt.bold || c.bold ? 800 : 600); ctx.fillStyle = opt.color && opt.color[i] ? opt.color[i] : C.ink;
        }
        ctx.direction = 'ltr'; ctx.textAlign = 'right'; ctx.fillText(fit(ctx, cell.t, room), p.right - 12, y + h / 2); ctx.direction = 'rtl';
      } else { const txt = fit(ctx, cell.t, p.w - 16); ctx.textAlign = c.center ? 'center' : 'right'; ctx.fillText(txt, c.center ? (p.left + p.right) / 2 : p.right - 10, y + h / 2); }
    });
    return y + h;
  }
  function foot(ctx, d, page, pages) {
    const y = H - M + 8; ctx.fillStyle = C.gold; ctx.fillRect(M, y - 26, W - 2 * M, 2);
    ctx.font = f(17, 600); ctx.fillStyle = C.muted;
    ctx.textAlign = 'right'; ctx.fillText(fit(ctx, d.brand.name || '', 420), W - M, y);
    ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText(`${page} / ${pages}`, W / 2, y); ctx.direction = 'rtl';
    ctx.textAlign = 'left'; ctx.direction = 'ltr'; ctx.fillText('FuelPro · ' + (d.stamp || ''), M, y); ctx.direction = 'rtl';
  }

  async function statement(d) {
    const logo = await loadImg(d.brand && d.brand.logo);
    const pages = []; let pg = newPage(); pages.push(pg);
    const xs = colX(d);
    let y = head(pg.ctx, d, logo); y = tableHead(pg.ctx, d, xs, y);
    const bottom = H - M - 40;
    const endH0 = 50 + (d.words ? 76 : 0) + (d.note ? 60 : 0) + 20;
    d.rows.forEach((cells, i) => {
      const left = d.rows.length - i;   // keep at least 3 rows with the totals rather than a lonely totals page
      if (y + 42 > bottom || (left === 3 && y + 3 * 42 + endH0 > bottom && y + 42 * 3 > bottom - 0)) { pg = newPage(); pages.push(pg); y = runHead(pg.ctx, d, pages.length); y = tableHead(pg.ctx, d, xs, y); }
      y = row(pg.ctx, d, xs, y, cells.cells || cells, { fill: (cells.fill) || (i % 2 ? C.zebra : null), color: cells.color, bold: cells.bold });
    });
    /* totals, amount in words and the objection note stay together */
    const endH = 50 + (d.words ? 76 : 0) + (d.note ? 60 : 0) + 20;
    if (y + endH > bottom) { pg = newPage(); pages.push(pg); y = runHead(pg.ctx, d, pages.length); y = tableHead(pg.ctx, d, xs, y); }
    pg.ctx.fillStyle = C.green; pg.ctx.fillRect(M, y, W - 2 * M, 3); y += 3;
    y = row(pg.ctx, d, xs, y, d.total, { h: 50, fill: C.soft, bold: true });
    if (d.words) {
      y += 20; rrect(pg.ctx, M, y, W - 2 * M, 60, 12); pg.ctx.fillStyle = '#fdf8ea'; pg.ctx.fill(); pg.ctx.lineWidth = 2; pg.ctx.strokeStyle = C.gold; pg.ctx.stroke();
      pg.ctx.textAlign = 'right'; pg.ctx.fillStyle = '#8a611a'; pg.ctx.font = f(19, 700); const lab = d.labels.words + ': '; pg.ctx.fillText(lab, W - M - 20, y + 30);
      const lw = pg.ctx.measureText(lab).width; pg.ctx.fillStyle = C.ink; pg.ctx.font = f(21, 800); pg.ctx.fillText(fit(pg.ctx, d.words, W - 2 * M - 60 - lw), W - M - 20 - lw, y + 30);
      y += 60;
    }
    if (d.note) { pg.ctx.textAlign = 'center'; pg.ctx.fillStyle = C.ink; pg.ctx.font = f(20, 800); pg.ctx.fillText(fit(pg.ctx, d.note, W - 2 * M), W / 2, y + 40); }
    pages.forEach((p, i) => foot(p.ctx, d, i + 1, pages.length));
    const jpegs = [];
    for (const p of pages) jpegs.push(await new Promise((ok) => p.cv.toBlob(async (b) => ok(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.9)));
    return pdf(jpegs);
  }

  /* a minimal PDF: one full-page JPEG per A4 page */
  function pdf(jpegs) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
    const PW = 595.28, PH = 841.89, n = jpegs.length;
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    jpegs.forEach((j, i) => {
      const p = 3 + i * 3, c = p + 1, im = p + 2, draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      obj(p, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${c} 0 R >>`));
      obj(c, () => put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
      obj(im, () => { put(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.length} >>\nstream\n`); put(j); put('\nendstream'); });
    });
    const total = 3 + n * 3, xref = len;
    put(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) put(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  window.FPPDF = { statement, pdf };
})();
