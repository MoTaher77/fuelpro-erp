/* Read-only figures used by the parity check and the dashboard. Totals are always computed from the ledger,
   never stored (ADR-23). */
import { sql } from 'kysely';
import { need, station } from './access.ts';
import type { Ctx, User } from './ctx.ts';

/** Trial balance of one station: Σ debit, Σ credit per account code over posted journals. */
export async function trialBalance(ctx: Ctx, user: User, sid: number, asOf = '9999-12-31') {
  need(user, 'report.read'); await station(ctx.db, user, sid);
  const rows = await ctx.db.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(['a.code', 'a.sys', sql<number>`sum(l.debit)`.as('debit'), sql<number>`sum(l.credit)`.as('credit')])
    .where('j.station_id', '=', sid).where('j.status', '=', 'posted').where('j.business_date', '<=', asOf)
    .groupBy(['a.code', 'a.sys']).orderBy('a.code').execute();
  return rows.map((r) => ({ code: r.code, sys: r.sys, debit: Number(r.debit), credit: Number(r.credit) }));
}
/** Today's sales summary of a station (dashboard tile). */
export async function daySummary(ctx: Ctx, user: User, sid: number, date?: string) {
  const st = await station(ctx.db, user, sid);
  const d = date || ctx.clock.today(st.timezone);
  const r = await ctx.db.selectFrom('sales').where('station_id', '=', sid).where('business_date', '=', d).where('voided_at', 'is', null).select([
    sql<number>`count(*)`.as('n'), sql<number>`coalesce(sum(quantity_ml), 0)`.as('qty_ml'), sql<number>`coalesce(sum(gross), 0)`.as('gross'),
    sql<number>`coalesce(sum(case when pay_type = 'cash' then gross else 0 end), 0)`.as('cash')
  ]).executeTakeFirstOrThrow();
  return { date: d, n: Number(r.n), qty_ml: Number(r.qty_ml), gross: Number(r.gross), cash: Number(r.cash), cur_dec: st.cur_dec, disp_dec: st.disp_dec, currency: st.currency };
}
