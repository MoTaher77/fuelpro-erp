'use strict';
/* FuelPro — new-station setup wizard (0.20).
   Four short steps: tax -> fuels and prices -> tanks -> pumps and meter readings, then the next jobs.
   Each step saves its own records through the normal API when «التالي» is pressed (the same checks, permissions and audit as the Setup screen),
   so closing the window never loses work and reopening it continues where the station stands. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, S, api, sp, guard, toast, field, sel, modal, render, loadBase, volMl, priceE4, uLbl, parseDec, dec, cd } = F;

  const done = () => ({ fuels: S.fuels && S.fuels.length > 0, tanks: S.tanks && S.tanks.length > 0, pumps: S.pumps && S.pumps.length > 0 });
  const needsSetup = () => { const d = done(); return !(d.fuels && d.tanks && d.pumps); };
  const num = (v, fn, msg) => { const r = fn(String(v || '').trim()); if (r == null) throw new Error(msg); return r; };

  function openWizard(startStep) {
    let step = startStep || (!done().fuels ? 0 : !done().tanks ? 2 : !done().pumps ? 3 : 4);
    const body = h('div', { class: 'wz' }); let m = null;
    const titles = [T('wzVat'), T('wzFuels'), T('wzTanks'), T('wzPumps'), T('wzDone')];
    const stepper = () => h('ol', { class: 'wz-steps' }, titles.slice(0, 4).map((t, i) => h('li', { class: i < step ? 'ok' : i === step ? 'cur' : '' }, h('i', null, i < step ? '✓' : String(i + 1)), h('span', null, t))));
    const existing = (items, label) => items.length ? h('p', { class: 'hint wz-have' }, '✓ ', label, ': ', items.map(x => x.name).join('، ')) : null;
    const nav = (back, next, nextLabel) => h('div', { class: 'row wz-nav' }, back ? h('button', { class: 'btn ghost', type: 'button', onclick: back }, T('wzBack')) : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => m && m.remove() }, T('wzLater')), next ? h('button', { class: 'btn', type: 'button', onclick: next }, nextLabel || T('wzNext')) : null);
    const go = (n) => { step = n; draw(); };
    /* check every row first, then create them; whatever was created stays visible even if a later row is refused by the server */
    const saveAll = async (jobs) => { try { for (const j of jobs) await api('POST', j.path, j.body); } finally { await loadBase(); } };
    const refresh = async () => { await loadBase(); };

    /* a row editor: rows of inputs, "add row" button; read() returns the typed values */
    function rows(cols, initial, presets) {
      const box = h('div', { class: 'wz-rows' }); const list = [];
      const add = (vals = {}) => {
        const cells = cols.map(c => { const el = c.type === 'select' ? sel('wz' + c.k + list.length, c.options(), vals[c.k] ?? '') : h('input', { id: 'wz' + c.k + list.length, type: c.type || 'text', inputmode: c.num ? 'decimal' : null, dir: c.num ? 'ltr' : null, value: vals[c.k] ?? '', placeholder: c.ph || '' }); return { c, el }; });
        const row = h('div', { class: 'wz-row' }, cells.map(({ c, el }) => h('div', null, h('label', null, c.label), el)),
          h('button', { class: 'btn ghost sm wz-x', type: 'button', 'aria-label': T('wzRemove'), onclick: () => { row.remove(); list.splice(list.indexOf(item), 1); } }, '×'));
        const item = { cells }; list.push(item); box.append(row);
      };
      (initial && initial.length ? initial : [{}]).forEach(add);
      const addBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => add() }, '＋ ', T('wzAddRow'));
      const pre = presets ? h('div', { class: 'wz-presets' }, presets.map(p => h('button', { class: 'chip', type: 'button', onclick: () => { const empty = list.find(i => !i.cells[0].el.value.trim()); if (empty) { empty.cells[0].el.value = p; } else add({ [cols[0].k]: p }); } }, p))) : null;
      return { el: h('div', null, pre, box, addBtn), read: () => list.map(i => Object.fromEntries(i.cells.map(({ c, el }) => [c.k, el.value.trim()]))).filter(r => Object.values(r).some(v => v)) };
    }

    const stepVat = () => {
      const vat = h('input', { id: 'wzVatPct', type: 'text', inputmode: 'decimal', dir: 'ltr', value: S.st && S.st.vat_bp ? String(S.st.vat_bp / 100) : '0' });
      const inc = h('input', { id: 'wzVatInc', type: 'checkbox', checked: !S.st || S.st.vat_included !== 0 });
      return h('div', { class: 'stack' }, h('p', { class: 'hint' }, T('wzVatHelp')),
        h('div', { class: 'grid' }, field(T('wzVatPct'), vat), h('div', null, h('label', null, T('wzVatInc')), h('label', { class: 'chk' }, inc, ' ', T('wzVatIncYes')))),
        nav(null, guard(async () => {
          const bp = parseDec(vat.value || '0', 2);   // 5.25 -> 525 basis points (parseDec returns the number scaled by 10^2)
          if (bp == null || bp > 10000) throw new Error(T('wzBadNumber'));
          if (cd('users.manage')) await api('PATCH', sp(''), { vat_bp: bp, vat_included: inc.checked });
          await refresh(); go(1);
        })));
    };

    const stepFuels = () => {
      const ed = rows([{ k: 'name', label: T('wzFuelName') }, { k: 'price', label: T('wzPrice', { u: uLbl() }), num: true, ph: '0.00' }, { k: 'cost', label: T('wzCost', { u: uLbl() }), num: true, ph: '0.00' }],
        [], [T('wzPetrol'), T('wzDiesel'), T('wzGas')]);
      return h('div', { class: 'stack' }, h('p', { class: 'hint' }, T('wzFuelsHelp')), existing(S.fuels || [], T('wzHave')), ed.el,
        nav(() => go(0), guard(async () => {
          const have = new Set((S.fuels || []).map(f => f.name)), jobs = [], seen = new Set();
          for (const r of ed.read()) {
            if (!r.name) throw new Error(T('wzFuelName')); if (have.has(r.name) || seen.has(r.name)) continue; seen.add(r.name);
            const price = r.price ? num(r.price, priceE4, T('wzBadNumber')) : 0, cost = r.cost ? num(r.cost, priceE4, T('wzBadNumber')) : 0;
            jobs.push({ path: sp('/fuels'), body: { name: r.name, price_e4: price, cost_e4: cost } });
          }
          await saveAll(jobs); if (!(S.fuels || []).length) throw new Error(T('wzNeedFuel')); go(2);
        })));
    };

    const stepTanks = () => {
      const fuels = () => (S.fuels || []).map(f => [f.id, f.name]);
      const ed = rows([{ k: 'name', label: T('wzTankName') }, { k: 'fuel_id', label: T('fuel'), type: 'select', options: fuels }, { k: 'cap', label: T('wzCap', { u: uLbl() }), num: true, ph: '40000' }, { k: 'lvl', label: T('wzLevel', { u: uLbl() }), num: true, ph: '0' }, { k: 'min', label: T('wzMin', { u: uLbl() }), num: true, ph: '0' }], []);
      return h('div', { class: 'stack' }, h('p', { class: 'hint' }, T('wzTanksHelp')), existing(S.tanks || [], T('wzHave')), ed.el,
        nav(() => go(1), guard(async () => {
          const have = new Set((S.tanks || []).map(t => t.name)), jobs = [], seen = new Set();
          for (const r of ed.read()) {
            if (!r.name) throw new Error(T('wzTankName')); if (have.has(r.name) || seen.has(r.name)) continue; seen.add(r.name);
            const cap = num(r.cap, volMl, T('wzBadNumber')), lvl = r.lvl ? num(r.lvl, volMl, T('wzBadNumber')) : 0, min = r.min ? num(r.min, volMl, T('wzBadNumber')) : 0;
            if (lvl > cap || min > cap) throw new Error(T('wzLevelOver') + ': ' + r.name);
            jobs.push({ path: sp('/tanks'), body: { name: r.name, fuel_id: Number(r.fuel_id), capacity_ml: cap, level_ml: lvl, min_ml: min } });
          }
          await saveAll(jobs); if (!(S.tanks || []).length) throw new Error(T('wzNeedTank')); go(3);
        })));
    };

    const stepPumps = () => {
      const tanks = () => (S.tanks || []).map(t => [t.id, t.name]);
      const ed = rows([{ k: 'name', label: T('wzPumpName') }, { k: 'tank_id', label: T('tank'), type: 'select', options: tanks }, { k: 'meter', label: T('wzMeter'), num: true, ph: '0' }], []);
      return h('div', { class: 'stack' }, h('p', { class: 'hint' }, T('wzPumpsHelp')), existing(S.pumps || [], T('wzHave')), ed.el,
        nav(() => go(2), guard(async () => {
          const have = new Set((S.pumps || []).map(p => p.name)), jobs = [], seen = new Set();
          for (const r of ed.read()) {
            if (!r.name) throw new Error(T('wzPumpName')); if (have.has(r.name) || seen.has(r.name)) continue; seen.add(r.name);
            jobs.push({ path: sp('/pumps'), body: { name: r.name, tank_id: Number(r.tank_id), meter_ml: r.meter ? num(r.meter, volMl, T('wzBadNumber')) : 0 } });
          }
          await saveAll(jobs); if (!(S.pumps || []).length) throw new Error(T('wzNeedPump')); go(4);
        }), T('wzFinish')));
    };

    const stepDone = () => h('div', { class: 'stack' }, h('div', { class: 'wz-ok' }, h('b', null, '✓ ', T('wzReady'))),
      h('p', null, T('wzSummary', { f: (S.fuels || []).length, t: (S.tanks || []).length, p: (S.pumps || []).length })),
      h('ol', { class: 'wz-next' }, [['users', 'wzNextUsers'], ['cust', 'wzNextCust'], ['shift', 'wzNextShift'], ['sales', 'wzNextSale']].filter(([tab]) => true).map(([tab, k]) => h('li', null, h('a', { href: '#' + tab, onclick: () => m && m.remove() }, T(k))))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { m.remove(); render(); } }, T('wzClose'))));

    function draw() {
      const views = [stepVat, stepFuels, stepTanks, stepPumps, stepDone];
      body.replaceChildren(...[step < 4 ? stepper() : null, views[step]()].filter(Boolean));
      const card = body.closest('.card'); if (card) card.scrollTop = 0;
    }
    draw();
    m = modal(T('wzTitle'), body, { closable: false });
    m.classList.add('wz-modal');
  }

  /* a call-to-action card on the dashboard and the setup screen while the station still lacks fuels, tanks or pumps */
  function banner() {
    return h('section', { class: 'card wz-banner' }, h('div', { class: 'wz-b' }, h('h2', null, T('wzBannerT')), h('p', { class: 'muted' }, T('wzBannerP')),
      h('button', { class: 'btn gold-btn', type: 'button', onclick: () => openWizard() }, '🚀 ', T('wzStart'))));
  }
  for (const key of ['dash', 'setup']) {
    const orig = F.VIEWS[key]; if (!orig) continue;
    F.VIEWS[key] = async (main) => { if (cd('config.edit') && needsSetup()) main.append(banner()); await orig(main); };
  }
  F.openWizard = openWizard;
})();
