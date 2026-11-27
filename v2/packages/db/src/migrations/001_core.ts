/* v2 schema, step 1: organisation, users, station set-up, shifts, sales, stock ledger, general ledger, audit.
   One definition for both engines; only id columns and triggers differ by dialect.
   Column names follow v1 (src/db.js) so rows can be compared and migrated one-to-one. */
import { sql, type Kysely, type CreateTableBuilder } from 'kysely';
import type { Dialect } from '@fuelpro/core';

export function m001(dialect: Dialect) {
  const pg = dialect === 'postgres';
  /** surrogate key: rowid alias on SQLite, identity BIGINT on PostgreSQL */
  const id = <T extends string>(t: CreateTableBuilder<T, never>) => pg
    ? t.addColumn('id', 'bigint', (c) => c.primaryKey().generatedByDefaultAsIdentity())
    : t.addColumn('id', 'integer', (c) => c.primaryKey());
  const big = 'bigint' as const;    // money, ml, e4 prices: BIGINT on PostgreSQL, INTEGER affinity on SQLite
  const ref = (table: string) => `${table}.id`;

  return {
    async up(db: Kysely<any>) {
      await id(db.schema.createTable('orgs')).addColumn('name', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('locked_through', 'text').execute();
      await id(db.schema.createTable('users')).addColumn('org_id', big, (c) => c.notNull().references(ref('orgs')))
        .addColumn('email', 'text', (c) => c.notNull().unique()).addColumn('name', 'text', (c) => c.notNull())
        .addColumn('role', 'text', (c) => c.notNull()).addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', 'text', (c) => c.notNull()).execute();
      await id(db.schema.createTable('stations')).addColumn('org_id', big, (c) => c.notNull().references(ref('orgs')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('currency', 'text', (c) => c.notNull())
        .addColumn('cur_dec', 'integer', (c) => c.notNull()).addColumn('disp_dec', 'integer').addColumn('timezone', 'text', (c) => c.notNull())
        .addColumn('vat_bp', 'integer', (c) => c.notNull().defaultTo(0)).addColumn('vat_included', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('allow_negative', 'integer', (c) => c.notNull().defaultTo(0)).addColumn('require_shift', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('loss_tolerance_bp', 'integer', (c) => c.notNull().defaultTo(50)).addColumn('created_at', 'text', (c) => c.notNull()).execute();
      await db.schema.createTable('user_stations').addColumn('user_id', big, (c) => c.notNull().references(ref('users')))
        .addColumn('station_id', big, (c) => c.notNull().references(ref('stations'))).addPrimaryKeyConstraint('user_stations_pk', ['user_id', 'station_id']).execute();
      await id(db.schema.createTable('fuels')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('price_e4', big, (c) => c.notNull().defaultTo(0))
        .addColumn('cost_e4', big, (c) => c.notNull().defaultTo(0)).addColumn('active', 'integer', (c) => c.notNull().defaultTo(1)).execute();
      await id(db.schema.createTable('tanks')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('fuel_id', big, (c) => c.notNull().references(ref('fuels')))
        .addColumn('capacity_ml', big, (c) => c.notNull()).addColumn('level_ml', big, (c) => c.notNull().defaultTo(0))
        .addColumn('min_ml', big, (c) => c.notNull().defaultTo(0)).addColumn('value', big, (c) => c.notNull().defaultTo(0))
        .addColumn('avg_cost_e4', big, (c) => c.notNull().defaultTo(0)).addColumn('active', 'integer', (c) => c.notNull().defaultTo(1)).execute();
      await id(db.schema.createTable('pumps')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('tank_id', big, (c) => c.notNull().references(ref('tanks')))
        .addColumn('fuel_id', big, (c) => c.notNull().references(ref('fuels'))).addColumn('meter_ml', big, (c) => c.notNull().defaultTo(0))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1)).execute();
      await id(db.schema.createTable('customers')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('phone', 'text').addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('credit_limit', big, (c) => c.notNull().defaultTo(0)).addColumn('terms_days', 'integer', (c) => c.notNull().defaultTo(30))
        .addColumn('opening_balance', big, (c) => c.notNull().defaultTo(0)).addColumn('created_on', 'text').addColumn('ref', 'text').execute();
      await id(db.schema.createTable('shifts')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('business_date', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open').check(sql`status in ('open','closed','approved')`))
        .addColumn('float_amount', big, (c) => c.notNull().defaultTo(0)).addColumn('opened_by', big, (c) => c.notNull().references(ref('users')))
        .addColumn('opened_at', 'text', (c) => c.notNull()).addColumn('closed_by', big).addColumn('closed_at', 'text')
        .addColumn('counted_cash', big).addColumn('expected_cash', big).addColumn('variance', big).addColumn('close_note', 'text')
        .addColumn('approved_by', big).addColumn('approved_at', 'text').execute();
      await db.schema.createIndex('shifts_station').on('shifts').columns(['station_id', 'id']).execute();
      await db.schema.createIndex('shifts_one_open').on('shifts').column('station_id').unique().where(sql.ref('status'), '=', 'open').execute();
      await db.schema.createTable('shift_meters').addColumn('shift_id', big, (c) => c.notNull().references(ref('shifts')))
        .addColumn('pump_id', big, (c) => c.notNull().references(ref('pumps'))).addColumn('open_ml', big, (c) => c.notNull())
        .addColumn('close_ml', big).addPrimaryKeyConstraint('shift_meters_pk', ['shift_id', 'pump_id']).execute();
      await id(db.schema.createTable('sales')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('client_id', 'text', (c) => c.notNull()).addColumn('pump_id', big, (c) => c.notNull().references(ref('pumps')))
        .addColumn('fuel_id', big, (c) => c.notNull().references(ref('fuels'))).addColumn('tank_id', big, (c) => c.notNull().references(ref('tanks')))
        .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('quantity_ml', big, (c) => c.notNull()).addColumn('price_e4', big, (c) => c.notNull()).addColumn('cost_e4', big, (c) => c.notNull())
        .addColumn('net', big, (c) => c.notNull()).addColumn('vat', big, (c) => c.notNull()).addColumn('gross', big, (c) => c.notNull())
        .addColumn('vat_bp', 'integer', (c) => c.notNull()).addColumn('vat_included', 'integer', (c) => c.notNull())
        .addColumn('pay_type', 'text', (c) => c.notNull().check(sql`pay_type in ('cash','credit')`)).addColumn('customer_id', big, (c) => c.references(ref('customers')))
        .addColumn('open_ml', big, (c) => c.notNull()).addColumn('close_ml', big, (c) => c.notNull()).addColumn('user_id', big, (c) => c.notNull().references(ref('users')))
        .addColumn('voided_at', 'text').addColumn('void_reason', 'text').addColumn('void_by', big).addColumn('cogs', big)
        .addColumn('shift_id', big, (c) => c.references(ref('shifts'))).addColumn('note', 'text').addColumn('ref', 'text').addColumn('bill', 'text')
        .addColumn('discount', big, (c) => c.notNull().defaultTo(0)).addUniqueConstraint('sales_client_id', ['station_id', 'client_id']).execute();
      await db.schema.createIndex('sales_station_date').on('sales').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('sales_station_id').on('sales').columns(['station_id', 'id']).execute();   // latest sales list (keyset paging)
      await db.schema.createIndex('sales_tank_day').on('sales').columns(['tank_id', 'business_date']).execute();
      await db.schema.createIndex('sales_shift').on('sales').column('shift_id').execute();
      await db.schema.createIndex('sales_customer').on('sales').column('customer_id').execute();
      await id(db.schema.createTable('stock_moves')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('tank_id', big, (c) => c.notNull().references(ref('tanks'))).addColumn('business_date', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull()).addColumn('kind', 'text', (c) => c.notNull()).addColumn('ref_type', 'text').addColumn('ref_id', big)
        .addColumn('qty_ml', big, (c) => c.notNull()).addColumn('value', big, (c) => c.notNull()).addColumn('balance_ml', big, (c) => c.notNull())
        .addColumn('balance_value', big, (c) => c.notNull()).addColumn('avg_cost_e4', big, (c) => c.notNull()).addColumn('user_id', big).execute();
      await db.schema.createIndex('stock_moves_tank').on('stock_moves').columns(['tank_id', 'id']).execute();
      await db.schema.createIndex('stock_moves_day').on('stock_moves').columns(['station_id', 'business_date']).execute();
      await id(db.schema.createTable('accounts')).addColumn('org_id', big, (c) => c.notNull().references(ref('orgs')))
        .addColumn('code', 'text', (c) => c.notNull()).addColumn('type', 'text', (c) => c.notNull()).addColumn('name_ar', 'text', (c) => c.notNull())
        .addColumn('name_en', 'text', (c) => c.notNull()).addColumn('sys', 'text').addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('parent_id', big).addColumn('is_group', 'integer', (c) => c.notNull().defaultTo(0)).addColumn('box', 'text').addColumn('currency', 'text')
        .addUniqueConstraint('accounts_org_code', ['org_id', 'code']).execute();
      await db.schema.createIndex('accounts_org_sys').on('accounts').columns(['org_id', 'sys']).execute();
      await id(db.schema.createTable('journals')).addColumn('org_id', big, (c) => c.notNull().references(ref('orgs')))
        .addColumn('station_id', big, (c) => c.notNull().references(ref('stations'))).addColumn('business_date', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull()).addColumn('status', 'text', (c) => c.notNull().defaultTo('draft').check(sql`status in ('draft','posted')`))
        .addColumn('posted_at', 'text').addColumn('source', 'text', (c) => c.notNull()).addColumn('source_id', big).addColumn('memo', 'text')
        .addColumn('user_id', big).addColumn('reversal_of', big).addColumn('reversed_by', big).addColumn('ref', 'text').addColumn('doc_type', 'text').addColumn('doc_ref', 'text').execute();
      await db.schema.createIndex('journals_source').on('journals').columns(['org_id', 'source', 'source_id']).execute();
      await db.schema.createIndex('journals_post_day').on('journals').columns(['org_id', 'station_id', 'status', 'business_date', 'source']).execute();
      await id(db.schema.createTable('journal_lines')).addColumn('journal_id', big, (c) => c.notNull().references(ref('journals')))
        .addColumn('account_id', big, (c) => c.notNull().references(ref('accounts')))
        .addColumn('debit', big, (c) => c.notNull().defaultTo(0).check(sql`debit >= 0`)).addColumn('credit', big, (c) => c.notNull().defaultTo(0).check(sql`credit >= 0`))
        .addColumn('party_type', 'text').addColumn('party_id', big).addColumn('memo', 'text').addColumn('fc_code', 'text').addColumn('fc_amount', big).addColumn('fc_rate_e6', big).execute();
      // covering indexes, as in v1: balances and statements are sums read straight from the index
      await db.schema.createIndex('jl_journal_cover').on('journal_lines').columns(['journal_id', 'account_id', 'debit', 'credit']).execute();
      await db.schema.createIndex('jl_account_cover').on('journal_lines').columns(['account_id', 'journal_id', 'debit', 'credit']).execute();
      await db.schema.createIndex('jl_party_cover').on('journal_lines').columns(['party_type', 'party_id', 'account_id', 'journal_id', 'debit', 'credit']).execute();
      await id(db.schema.createTable('audit')).addColumn('org_id', big, (c) => c.notNull()).addColumn('station_id', big).addColumn('user_id', big)
        .addColumn('action', 'text', (c) => c.notNull()).addColumn('entity', 'text').addColumn('entity_id', big).addColumn('detail', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull()).execute();
      await db.schema.createIndex('audit_org').on('audit').columns(['org_id', 'id']).execute();
      await db.schema.createIndex('audit_entity').on('audit').columns(['org_id', 'entity', 'entity_id']).execute();

      for (const s of pg ? PG_TRIGGERS : SQLITE_TRIGGERS) await sql.raw(s).execute(db);
    },
    async down() { throw new Error('v2 schema migrations are forward-only'); }
  };
}

/* The ledger guards: same rules as v1 triggers (src/db.js), plus "sales are never deleted". */
const SQLITE_TRIGGERS = [
  `CREATE TRIGGER stock_moves_append_only_u BEFORE UPDATE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock ledger is append-only'); END`,
  `CREATE TRIGGER stock_moves_append_only_d BEFORE DELETE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock ledger is append-only'); END`,
  `CREATE TRIGGER journal_post_balanced BEFORE UPDATE OF status ON journals WHEN OLD.status='draft' AND NEW.status='posted' BEGIN
     SELECT RAISE(ABORT, 'journal is not balanced') WHERE
       (SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) FROM journal_lines WHERE journal_id=NEW.id) <> 0
       OR (SELECT COUNT(*) FROM journal_lines WHERE journal_id=NEW.id) < 2; END`,
  `CREATE TRIGGER journal_no_unpost BEFORE UPDATE OF status ON journals WHEN OLD.status='posted' AND NEW.status<>'posted' BEGIN SELECT RAISE(ABORT, 'posted journals cannot be un-posted'); END`,
  `CREATE TRIGGER journal_no_edit BEFORE UPDATE OF business_date, station_id, org_id ON journals WHEN OLD.status='posted' BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END`,
  `CREATE TRIGGER journal_no_delete BEFORE DELETE ON journals WHEN OLD.status='posted' BEGIN SELECT RAISE(ABORT, 'posted journals cannot be deleted'); END`,
  `CREATE TRIGGER jl_no_insert_posted BEFORE INSERT ON journal_lines WHEN (SELECT status FROM journals WHERE id=NEW.journal_id)='posted' BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END`,
  `CREATE TRIGGER jl_no_update_posted BEFORE UPDATE ON journal_lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted' BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END`,
  `CREATE TRIGGER jl_no_delete_posted BEFORE DELETE ON journal_lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted' BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END`,
  `CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'sales are never deleted; void them'); END`
];
const PG_TRIGGERS = [
  `CREATE FUNCTION fp_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%', TG_ARGV[0]; END $$`,
  `CREATE TRIGGER stock_moves_append_only BEFORE UPDATE OR DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION fp_abort('stock ledger is append-only')`,
  `CREATE FUNCTION fp_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD.status = 'posted' THEN RAISE EXCEPTION 'posted journals cannot be deleted'; END IF;
       RETURN OLD;
     END IF;
     IF OLD.status = 'posted' AND NEW.status <> 'posted' THEN RAISE EXCEPTION 'posted journals cannot be un-posted'; END IF;
     IF OLD.status = 'posted' AND (NEW.business_date IS DISTINCT FROM OLD.business_date OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.org_id IS DISTINCT FROM OLD.org_id)
       THEN RAISE EXCEPTION 'posted journals are immutable'; END IF;
     IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
       IF (SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) FROM journal_lines WHERE journal_id = NEW.id) <> 0
          OR (SELECT COUNT(*) FROM journal_lines WHERE journal_id = NEW.id) < 2 THEN RAISE EXCEPTION 'journal is not balanced'; END IF;
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER journal_guard BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION fp_journal_guard()`,
  `CREATE FUNCTION fp_jl_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE jid bigint;
   BEGIN
     jid := CASE WHEN TG_OP = 'INSERT' THEN NEW.journal_id ELSE OLD.journal_id END;
     IF (SELECT status FROM journals WHERE id = jid) = 'posted' THEN RAISE EXCEPTION 'posted journals are immutable'; END IF;
     RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
   END $$`,
  `CREATE TRIGGER jl_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION fp_jl_guard()`,
  `CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales FOR EACH ROW EXECUTE FUNCTION fp_abort('sales are never deleted; void them')`
];
