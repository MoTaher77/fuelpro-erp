/* Table types of the v2 core (phase 1: organisation, station set-up, sales, shifts, stock and the ledger).
   Column names and meanings are the same as v1 (src/db.js), so a migration and a parity check can compare rows directly.
   Money/volume/price columns are BIGINT on PostgreSQL and INTEGER on SQLite; both reach the core as safe JS integers. */
import type { Generated, Insertable, Selectable } from 'kysely';
type Id = Generated<number>;
type Def<T> = Generated<T>;

export interface OrgsT { id: Id; name: string; created_at: string; locked_through: string | null }
export interface UsersT { id: Id; org_id: number; email: string; name: string; role: string; active: Def<number>; created_at: string }
export interface UserStationsT { user_id: number; station_id: number }
export interface StationsT {
  id: Id; org_id: number; name: string; currency: string; cur_dec: number; disp_dec: number | null; timezone: string;
  vat_bp: Def<number>; vat_included: Def<number>; allow_negative: Def<number>; require_shift: Def<number>; loss_tolerance_bp: Def<number>; created_at: string;
}
export interface FuelsT { id: Id; station_id: number; name: string; price_e4: Def<number>; cost_e4: Def<number>; active: Def<number> }
export interface TanksT {
  id: Id; station_id: number; name: string; fuel_id: number; capacity_ml: number; level_ml: Def<number>; min_ml: Def<number>;
  value: Def<number>; avg_cost_e4: Def<number>; active: Def<number>;
}
export interface PumpsT { id: Id; station_id: number; name: string; tank_id: number; fuel_id: number; meter_ml: Def<number>; active: Def<number> }
export interface CustomersT {
  id: Id; station_id: number; name: string; phone: string | null; active: Def<number>; credit_limit: Def<number>; terms_days: Def<number>;
  opening_balance: Def<number>; created_on: string | null; ref: string | null;
}
export interface ShiftsT {
  id: Id; station_id: number; business_date: string; status: Def<'open' | 'closed' | 'approved'>; float_amount: Def<number>;
  opened_by: number; opened_at: string; closed_by: number | null; closed_at: string | null; counted_cash: number | null;
  expected_cash: number | null; variance: number | null; close_note: string | null; approved_by: number | null; approved_at: string | null;
}
export interface ShiftMetersT { shift_id: number; pump_id: number; open_ml: number; close_ml: number | null }
export interface SalesT {
  id: Id; station_id: number; client_id: string; pump_id: number; fuel_id: number; tank_id: number; business_date: string; created_at: string;
  quantity_ml: number; price_e4: number; cost_e4: number; net: number; vat: number; gross: number; vat_bp: number; vat_included: number;
  pay_type: 'cash' | 'credit'; customer_id: number | null; open_ml: number; close_ml: number; user_id: number;
  voided_at: string | null; void_reason: string | null; void_by: number | null; cogs: number | null; shift_id: number | null;
  note: string | null; ref: string | null; bill: string | null; discount: Def<number>;
}
export interface StockMovesT {
  id: Id; station_id: number; tank_id: number; business_date: string; created_at: string; kind: string; ref_type: string | null; ref_id: number | null;
  qty_ml: number; value: number; balance_ml: number; balance_value: number; avg_cost_e4: number; user_id: number | null;
}
export interface AccountsT {
  id: Id; org_id: number; code: string; type: string; name_ar: string; name_en: string; sys: string | null; active: Def<number>;
  parent_id: number | null; is_group: Def<number>; box: string | null; currency: string | null;
}
export interface JournalsT {
  id: Id; org_id: number; station_id: number; business_date: string; created_at: string; status: Def<'draft' | 'posted'>; posted_at: string | null;
  source: string; source_id: number | null; memo: string | null; user_id: number | null; reversal_of: number | null; reversed_by: number | null;
  ref: string | null; doc_type: string | null; doc_ref: string | null;
}
export interface JournalLinesT {
  id: Id; journal_id: number; account_id: number; debit: Def<number>; credit: Def<number>; party_type: string | null; party_id: number | null;
  memo: string | null; fc_code: string | null; fc_amount: number | null; fc_rate_e6: number | null;
}
export interface AuditT {
  id: Id; org_id: number; station_id: number | null; user_id: number | null; action: string; entity: string | null; entity_id: number | null;
  detail: string | null; created_at: string;
}

export interface DB {
  orgs: OrgsT; users: UsersT; user_stations: UserStationsT; stations: StationsT; fuels: FuelsT; tanks: TanksT; pumps: PumpsT;
  customers: CustomersT; shifts: ShiftsT; shift_meters: ShiftMetersT; sales: SalesT; stock_moves: StockMovesT;
  accounts: AccountsT; journals: JournalsT; journal_lines: JournalLinesT; audit: AuditT;
}
export type Station = Selectable<StationsT>;
export type Sale = Selectable<SalesT>;
export type Shift = Selectable<ShiftsT>;
export type Tank = Selectable<TanksT>;
export type NewJournalLine = Insertable<JournalLinesT>;
