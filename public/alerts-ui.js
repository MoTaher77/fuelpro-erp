'use strict';
/* «التنبيهات» — the bell in the top bar: a badge with how many things need attention, and a list that opens the right screen. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, S, api, sp, cd, modal, money, vol, fdate } = F;
  let last = null, timer = null;

  const line = (a) => {
    const it = a.items || [], nm = (x) => x.name || x.name_ar || x.code || '';
    const list = (fn) => it.map(fn).join(' · ');
    switch (a.kind) {
      case 'stock_low': return list(x => `${x.name} (${x.fuel}): ${vol(x.level_ml)}`);
      case 'stock_soon': return list(x => `${x.name}: ${x.days_cover} ${T('days')}`);
      case 'shift_open': return it[0] ? `#${it[0].id} — ${it[0].hours} ${T('hours')}` : '';
      case 'shift_variance': return `${a.n} · ${money(a.amount)}`;
      case 'credit_limit': return list(x => `${nm(x)}: ${money(x.balance)} / ${money(x.credit_limit)}`);
      case 'late_customers': case 'late_suppliers': return `${money(a.amount)} — ` + list(x => `${nm(x)}: ${money(x.amount)}`);
      case 'box_negative': return list(x => `${x.code} ${nm(x)}: ${money(x.bal)}`);
      case 'no_sales': return it[0] ? fdate(it[0].date) : '';
      case 'bank_open': return list(x => `${x.code} — ${fdate(x.statement_date)}`);
      case 'integrity': return list(x => x.name);
      default: return '';
    }
  };

  async function load() {
    if (!S.user || !S.sid || !cd('report.read')) return null;
    try { last = await api('GET', sp('/alerts')); } catch { return last; }
    return last;
  }
  function paint() {
    const b = document.getElementById('bellN'), btn = document.getElementById('bell'); if (!b || !btn) return;
    const c = last ? last.counts : { critical: 0, warning: 0, info: 0 }, n = c.critical + c.warning;
    b.textContent = n ? String(n) : ''; b.classList.toggle('on', n > 0); b.classList.toggle('crit', c.critical > 0);
    btn.title = n ? T('alerts') + ': ' + n : T('alerts');
  }
  F.bellRefresh = async () => { if (!document.getElementById('bell')) return; await load(); paint(); clearTimeout(timer); timer = setTimeout(F.bellRefresh, 300000); };

  F.showAlerts = async () => {
    await load(); paint();
    const body = !last || !last.alerts.length ? h('p', { class: 'note good' }, T('alNone'))
      : h('div', { class: 'stack' }, last.alerts.map(a => h('a', { class: 'al al-' + a.severity, href: '#' + a.tab, onclick: () => m.remove() },
        h('span', { class: 'al-dot' }), h('div', null, h('b', null, T('al.' + a.kind), a.n > 1 ? ` (${a.n})` : ''), h('div', { class: 'muted small' }, line(a))))));
    const m = modal(T('alerts'), body);
  };
})();
