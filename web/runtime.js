'use strict';
/* FuelPro Artifact edition — page runtime (ADR-20).
   1. loads SQLite (sql.js, pure JavaScript build) and the FuelPro core (unchanged src/ + shims)
   2. opens the saved database from the Artifact's own storage (claude `db` capability) or the DEMO seed
   3. answers the app's fetch('/api/...') calls with the real server code — same routes, permissions, validation,
      transactions, journals and audit as the Node server
   4. after every successful change, saves the database file back to storage (content-addressed 128 KB blocks,
      only changed blocks are written, then one state document switches to the new version)
   Nothing here imitates an accounting result: every number comes from the SQL in src/. */
(function () {
  const SQLJS_WASM = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js';            // fast (WebAssembly)
  const SQLJS_ASM = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm-memory-growth.js';  // fallback (plain JavaScript, ~10x slower)
  let engineName = '';
  const BLOCK = 128 * 1024;
  const $ = (id) => document.getElementById(id);
  const say = (t) => { const e = $('fpBootMsg'); if (e) e.textContent = t; };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };

  const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('load failed: ' + src)); document.head.append(s); });
  const b64ToBytes = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const bytesToB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const pipe = async (u8, stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
  const gunzip = (u8) => pipe(u8, new DecompressionStream('gzip'));
  const gzip = (u8) => pipe(u8, new CompressionStream('gzip'));
  const hashHex = async (u8) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');

  /* ---------- in-page dialogs (the viewer ignores confirm/alert) ---------- */
  function ask(text, okText, danger) {
    return new Promise((resolve) => {
      const d = document.createElement('div'); d.className = 'fp-dlg'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      const box = document.createElement('div'); const p = document.createElement('p'); p.textContent = text; p.style.margin = '0';
      const row = document.createElement('div'); row.className = 'row';
      const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = 'إلغاء';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn ' + (danger ? 'danger' : ''); yes.textContent = okText || 'موافق';
      const done = (v) => { d.remove(); resolve(v); }; no.onclick = () => done(false); yes.onclick = () => done(true);
      d.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
      row.append(no, yes); box.append(p, row); d.append(box); document.body.append(d); yes.focus();
    });
  }
  window.__fpConfirm = (text) => ask(text, 'موافق', true);
  function notice(text) { const t = document.getElementById('toast'); if (t) { t.textContent = text; t.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(() => { t.hidden = true; }, 4500); } }
  /* printing is not available inside claude.ai (window.print does nothing there) */
  window.print = () => notice('الطباعة غير متاحة داخل Claude. اطبع من نسخة FuelPro على اللابتوب، أو استخدم زر Excel لتنزيل الجدول.');
  /* files the app offers (Excel, CSV) go through the viewer's download prompt instead of a blocked <a download> */
  const aClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute('download') || !/^(blob:|data:)/.test(this.href)) return aClick.call(this);
    const name = this.getAttribute('download') || 'fuelpro-export', href = this.href;
    (async () => {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
      if (!dl) { notice('التنزيل غير متاح في هذا العرض.'); return; }
      try { const blob = await (await fetch(href)).blob(); await dl.save({ filename: name, data: blob }); } catch (e) { if (e && e.code !== 'declined') notice('لم يتم التنزيل.'); }
    })();
  };

  /* ---------- status chip (bottom corner): saved / saving / not saved / conflict ---------- */
  let chip;
  function status(kind, text) {
    if (!chip) { chip = document.createElement('div'); chip.id = 'fpChip'; chip.setAttribute('role', 'button'); chip.tabIndex = 0; chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu(); } }); document.body.append(chip);
      chip.addEventListener('click', () => menu()); }
    chip.className = 'fp-chip ' + kind; chip.textContent = text;
  }
  function menu() {
    const old = $('fpMenu'); if (old) { old.remove(); return; }
    const m = document.createElement('div'); m.id = 'fpMenu'; m.className = 'fp-menu';
    const info = document.createElement('p'); info.textContent = `المحرك: ${engineName} · ` + (store ? `نسخة التخزين: ${gen || 'بيانات تجريبية جديدة'} — تُحفظ تلقائياً بعد كل عملية` : 'التخزين غير متاح هنا: التغييرات تبقى حتى إغلاق الصفحة فقط');
    m.append(info);
    const btn = (t, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.className = 'btn ' + (cls || 'ghost') + ' sm'; b.onclick = () => { m.remove(); fn(); }; m.append(b); };
    if (store) btn('حفظ الآن', () => save(true));
    btn('تنزيل نسخة من قاعدة البيانات', downloadDb);
    if (store && window.__FP_STATION) btn('تحديث البيانات من نسخة اللابتوب…', importDb);
    if (store) btn('إعادة البيانات إلى نقطة البداية', resetDemo, 'danger');
    btn('إغلاق', () => {});
    document.body.append(m);
  }

  /* ---------- storage (Artifact db capability) ---------- */
  let store = null, gen = 0, known = new Set(), blocksNow = [], dirty = false, saving = false, again = false, timer = 0, conflict = false;
  async function openStore() {
    if (!window.claude || !window.claude.use) return null;
    const db = await Promise.race([window.claude.use('db').catch(() => null), new Promise(r => setTimeout(() => r(null), 10000))]);
    return db || null;
  }
  /* ---------- this device's copy (IndexedDB): opening again on the same device needs one small read, not the whole file ---------- */
  const CACHE_DB = 'fuelpro-page', CACHE_KEY = 'db';
  const idb = () => new Promise((ok, no) => { try { const q = indexedDB.open(CACHE_DB, 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); } catch (e) { no(e); } });
  async function cacheGet() { try { const d = await idb(); return await new Promise((ok) => { const r = d.transaction('kv').objectStore('kv').get(CACHE_KEY); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch { return null; } }
  async function cachePut(v) { try { const d = await idb(); await new Promise((ok) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, CACHE_KEY); t.oncomplete = ok; t.onerror = ok; t.onabort = ok; }); } catch { /* the cache is only a speed-up */ } }
  const sameList = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

  async function loadSaved() {
    const st = await store.doc('fpstate/main').get(); if (!st.exists) return null;
    const s = st.data();
    const c = await cacheGet();
    if (c && c.gen === s.gen && c.size === s.size && sameList(c.blocks, s.blocks) && c.bytes && c.bytes.byteLength === s.size) {
      gen = s.gen; blocksNow = s.blocks.slice(); known = new Set(s.blocks); return new Uint8Array(c.bytes);
    }
    /* download the blocks in parallel (about 12 at a time), reusing any block this device already holds */
    const have = new Map(); if (c && c.bytes && c.blocks) { let o = 0; const B = new Uint8Array(c.bytes); for (const h of c.blocks) { have.set(h, B.subarray(o, Math.min(o + BLOCK, B.length))); o += BLOCK; } }
    const parts = new Array(s.blocks.length); let next = 0, done = 0;
    const worker = async () => { while (next < s.blocks.length) { const i = next++, h = s.blocks[i];
      if (have.has(h)) parts[i] = have.get(h);
      else { const d = await store.doc('fpblk/' + h).get(); if (!d.exists) throw new Error('missing block ' + h); parts[i] = await gunzip(b64ToBytes(d.data().d)); }
      done++; if (done % 8 === 0 || done === s.blocks.length) say(`تحميل البيانات… ${Math.round(done * 100 / s.blocks.length)}%`); } };
    await Promise.all(Array.from({ length: 12 }, worker));
    const out = new Uint8Array(s.size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    gen = s.gen; blocksNow = s.blocks.slice(); known = new Set(s.blocks);
    cachePut({ gen, size: s.size, blocks: blocksNow, bytes: out.buffer.slice(0) });
    return out;
  }
  async function save(force, replaceWith) {
    if (!store || conflict) return; if (saving) { if (replaceWith) throw new Error('busy'); again = true; return; }
    if (!dirty && !force) return;
    saving = true; dirty = false; status('saving', 'جارٍ الحفظ…');
    try {
      const bytes = replaceWith || core.engine.bytes(); const hashes = [], todo = [];
      for (let o = 0; o < bytes.length; o += BLOCK) {
        const part = bytes.subarray(o, Math.min(o + BLOCK, bytes.length)); const h = await hashHex(part); hashes.push(h);
        if (!known.has(h) && !todo.some(t => t.h === h)) todo.push({ h, part });
      }
      /* only the blocks that changed, 8 at a time; the state document switches to them afterwards */
      let k = 0; const put = async () => { while (k < todo.length) { const t = todo[k++]; await store.doc('fpblk/' + t.h).set({ d: bytesToB64(await gzip(t.part)), n: t.part.length }); known.add(t.h); } };
      await Promise.all(Array.from({ length: 8 }, put));
      const cur = await store.doc('fpstate/main').get();
      if (cur.exists && cur.data().gen !== gen) { conflict = true; status('bad', 'تعارض: حُفظت بيانات أحدث من جهاز آخر — أعد فتح الصفحة'); return; }
      const next = gen + 1;
      await store.doc('fpstate/main').set({ gen: next, blocks: hashes, size: bytes.length, saved_at: new Date().toISOString(), app: window.__FP_BUILD || '' });
      const orphans = blocksNow.filter(h => !hashes.includes(h)); gen = next; blocksNow = hashes;
      for (const h of orphans) { known.delete(h); await store.doc('fpblk/' + h).delete().catch(() => {}); }
      cachePut({ gen, size: bytes.length, blocks: hashes, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
      if (dirty || again) status('saving', 'تغييرات غير محفوظة…'); else status('ok', 'محفوظ ✓');
    } catch (e) {
      dirty = true; status('bad', 'لم يُحفظ: ' + ((e && (e.message || e.code)) || 'خطأ') + ' — اضغط للمحاولة');
    } finally { saving = false; if (again || (dirty && !conflict)) { again = false; clearTimeout(timer); timer = setTimeout(() => save(), 50); } }
  }
  const markDirty = () => { dirty = true; if (store && !conflict) { status('saving', 'تغييرات غير محفوظة…'); clearTimeout(timer); timer = setTimeout(() => save(), 1200); } };
  async function resetDemo() {
    if (!(await ask('ستُحذف كل العمليات المحفوظة في هذه الصفحة وتعود البيانات كما كانت عند النشر. متابعة؟', 'إعادة الضبط', true))) return;
    status('saving', 'جارٍ إعادة الضبط…');
    const old = blocksNow.slice(); await store.doc('fpstate/main').delete();
    for (const h of old) await store.doc('fpblk/' + h).delete().catch(() => {});
    ls.set('fp.sid', null); location.reload();
  }
  /* the station page refreshed from the laptop: a backup file (npm run backup → data\\backups\\*.db) replaces this page's data.
     The file is checked first (SQLite, FuelPro tables, integrity, someone can sign in); sessions are dropped; nothing goes back to the laptop. */
  let SQLref = null;
  function importDb() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.db,.sqlite,application/octet-stream,application/vnd.sqlite3';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      let t = null;
      try {
        status('saving', 'فحص الملف…');
        const raw = new Uint8Array(await f.arrayBuffer());
        if (new TextDecoder().decode(raw.subarray(0, 15)) !== 'SQLite format 3') throw new Error('الملف ليس قاعدة بيانات FuelPro');
        t = new SQLref.Database(raw);
        const one = (q) => { const r = t.exec(q); return r.length ? r[0].values[0][0] : null; };
        if (one("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('orgs','users','journals','journal_lines','sales','customers')") !== 6) throw new Error('الملف لا يحتوي جداول FuelPro');
        if (one('PRAGMA quick_check') !== 'ok') throw new Error('الملف تالف (فشل فحص السلامة)');
        const users = one("SELECT COUNT(*) FROM users WHERE active=1 AND pw_hash LIKE 'scrypt$%'");
        if (!users) throw new Error('لا يوجد في الملف مستخدم يستطيع الدخول (كلمات المرور محذوفة منه). استخدم نسخة npm run backup وليس اللقطة.');
        const sales = one('SELECT COUNT(*) FROM sales'), last = one('SELECT MAX(business_date) FROM sales') || '—', cust = one('SELECT COUNT(*) FROM customers');
        const tf = one('SELECT COUNT(*) FROM users WHERE active=1 AND totp_enabled=1');
        t.exec('PRAGMA journal_mode=DELETE'); t.exec('DELETE FROM sessions');
        const bytes = t.export(); t.close(); t = null;
        const msg = `سيُستبدل كل ما في هذه الصفحة ببيانات الملف «${f.name}»:\n${sales} فاتورة (آخرها ${last}) · ${cust} عميل · ${users} مستخدم.\nستدخل بعدها بحسابك المعتاد على اللابتوب.` + (tf ? `\nتنبيه: ${tf} حساب عليه التحقق الثنائي، وقد لا يستطيع الدخول هنا إن كان مشفّراً بمفتاح اللابتوب.` : '') + '\nالعمليات المسجّلة في هذه الصفحة فقط ستُفقد.';
        if (!(await ask(msg, 'تحديث البيانات', true))) { status('ok', 'محفوظ ✓'); return; }
        await save(true, bytes);
        if (conflict) return;
        conflict = true;   // this view still runs the old data: stop saving it, sign out and reopen on the new data
        ls.set('fp.sid', null); location.reload();
      } catch (e) {
        try { if (t) t.close(); } catch { /* already closed */ }
        status('bad', 'لم يتم التحديث: ' + (e && e.message || e));
      }
    };
    inp.click();
  }

  async function downloadDb() {
    const bytes = core.engine.bytes(); const name = `fuelpro-artifact-${new Date().toISOString().slice(0, 10)}.db`;
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (!dl) { notice('التنزيل غير متاح في هذا العرض.'); return; }
    try { await dl.save({ filename: name, data: new Blob([bytes], { type: 'application/octet-stream' }) }); } catch { /* the viewer declined */ }
  }

  /* ---------- the API bridge ---------- */
  let core = null;
  function installFetch() {
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') return orig(input, init);
      const method = (init.method || 'GET').toUpperCase(), headers = {};
      new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
      if (window.__FP_NO_REGISTER && /\/auth\/register$/.test(url.pathname)) {   // the station page holds one organisation: no new accounts there
        return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'إنشاء حساب جديد غير متاح في صفحة المحطة. ادخل بحساب المحطة.' } }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      const sid = ls.get('fp.sid') || window.__FP_SID; if (sid) headers.cookie = 'sid=' + sid;
      const r = await core.request(method, url.pathname + url.search, { headers, body: init.body });
      const sc = r.headers['Set-Cookie']; if (sc) { const v = /^sid=([^;]*)/.exec(sc); if (v) { window.__FP_SID = v[1] || null; ls.set('fp.sid', v[1] || null); } }
      if (method !== 'GET' && method !== 'HEAD' && r.status < 400 && !/\/auth\/(login|logout)$/.test(url.pathname)) markDirty();
      if (/\/auth\/login$/.test(url.pathname) && r.status < 400) markDirty();   // sessions live in the database too
      const nullBody = r.status === 204 || r.status === 304;
      return new Response(nullBody ? null : r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    };
  }

  /* WebAssembly SQLite when the page may compile it (binary published beside the page), else the pure-JS build */
  async function loadEngine() {
    try {
      const bin = await fetch('sql-wasm.wasm').then(r => { if (!r.ok) throw new Error('wasm ' + r.status); return r.arrayBuffer(); });
      await loadScript(SQLJS_WASM);
      const SQL = await Promise.race([window.initSqlJs({ wasmBinary: bin }), new Promise((_, no) => setTimeout(() => no(new Error('wasm timeout')), 10000))]);
      new SQL.Database().close(); engineName = 'WebAssembly'; window.__FP_ENGINE = engineName; return SQL;
    } catch (e) { console.warn('[fuelpro] fast engine unavailable, using the JavaScript engine:', e && e.message); }
    try { delete window.initSqlJs; } catch { window.initSqlJs = undefined; }
    await loadScript(SQLJS_ASM); engineName = 'JavaScript'; window.__FP_ENGINE = engineName; return window.initSqlJs();
  }

  async function boot() {
    try {
      say('تحميل محرك قاعدة البيانات…');
      const SQL = await loadEngine(); SQLref = SQL;
      say('فتح البيانات المحفوظة…');
      store = await openStore();
      let bytes = null;
      if (store) { try { bytes = await loadSaved(); } catch (e) { console.error(e); say('تعذّرت قراءة النسخة المحفوظة؛ ستُفتح البيانات التجريبية'); store = null; } }
      if (!bytes) { say('تجهيز البيانات الأولية…'); if (!window.__FP_SEED_GZ_B64) await loadScript('seed.js'); bytes = await gunzip(b64ToBytes(window.__FP_SEED_GZ_B64)); window.__FP_SEED_GZ_B64 = null; }
      window.__FP_DB_BYTES = bytes;
      window.FP_SQLITE = window.FP_makeSqlite(SQL);
      core = window.FPCore.start(); window.__FP_CORE = core; window.__FP_DB_BYTES = null;
      installFetch();
      say('تحميل الواجهة…');
      for (const f of window.__FP_APP_FILES) await loadScript(f);
      $('fpBoot').remove();
      status(store ? 'ok' : 'warn', store ? (gen ? 'محفوظ ✓' : 'بيانات تجريبية — تُحفظ بعد أول عملية') : 'وضع مؤقت: لا يوجد تخزين');
      addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) save(); });
      if (store) store.doc('fpstate/main').onSnapshot((d) => { if (d.exists && d.data().gen > gen && !saving) { conflict = true; status('bad', 'حُفظت بيانات أحدث من جهاز آخر — اضغط ثم أعد فتح الصفحة'); } }, () => {});
    } catch (e) {
      console.error(e); say('تعذّر التشغيل: ' + (e && e.message));
    }
  }
  window.__FP_SAVE = save;
  boot();
})();
