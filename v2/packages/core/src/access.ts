/* Isolation and permissions: every query is scoped by org, then by station (owner/admin = org-wide).
   A foreign id is "not found" (404), never "forbidden", so ids from other tenants leak nothing. */
import type { Ctx, Q, User } from './ctx.ts';
import { forbidden, notFound } from './errors.ts';
import { ORG_WIDE, can } from './perms.ts';
import type { DB, Station } from './schema.ts';

export function need(user: User, perm: string): void { if (!can(user.role, perm)) throw forbidden(); }

export async function station(q: Q, user: User, sid: number): Promise<Station> {
  const s = await q.selectFrom('stations').selectAll().where('id', '=', sid).where('org_id', '=', user.org_id).executeTakeFirst();
  if (!s) throw notFound('Station');
  if (!ORG_WIDE.has(user.role) &&
    !(await q.selectFrom('user_stations').select('user_id').where('user_id', '=', user.id).where('station_id', '=', sid).executeTakeFirst())) throw notFound('Station');
  return s;
}
type StationTable = 'pumps' | 'tanks' | 'fuels' | 'customers' | 'sales' | 'shifts';
/** One row of a station-owned table, or 404. On PostgreSQL `forUpdate` locks it for the rest of the transaction. */
export async function scoped<T extends StationTable>(ctx: Ctx, q: Q, table: T, id: number, sid: number, what: string, forUpdate = false) {
  // the table name is a fixed union, never user input
  let qb = (q as unknown as import('kysely').Kysely<DB>).selectFrom(table as 'pumps').selectAll().where('id', '=', id).where('station_id', '=', sid);
  if (forUpdate && ctx.dialect === 'postgres') qb = qb.forUpdate();
  const row = await qb.executeTakeFirst();
  if (!row) throw notFound(what);
  return row as unknown as import('kysely').Selectable<DB[T]>;
}
export async function audit(ctx: Ctx, q: Q, user: User, stationId: number | null, action: string, entity: string | null, entityId: number | null, detail?: unknown) {
  await q.insertInto('audit').values({
    org_id: user.org_id, station_id: stationId || null, user_id: user.id, action, entity: entity || null, entity_id: entityId || null,
    detail: detail ? JSON.stringify(detail) : null, created_at: ctx.clock.now()
  }).execute();
}
