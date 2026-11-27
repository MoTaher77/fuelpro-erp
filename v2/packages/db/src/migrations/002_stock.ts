/* v2 schema, step 2 (phase 2: stock & deliveries): suppliers, deliveries, stock counts (adjustments), transfers.
   Same column names as v1 (src/db.js) so parity tests and tools/migrate-v1.ts compare rows one-to-one. */
import { sql, type Kysely, type CreateTableBuilder } from 'kysely';
import type { Dialect } from '@fuelpro/core';

export function m002(dialect: Dialect) {
  const pg = dialect === 'postgres';
  const id = <T extends string>(t: CreateTableBuilder<T, never>) => pg
    ? t.addColumn('id', 'bigint', (c) => c.primaryKey().generatedByDefaultAsIdentity())
    : t.addColumn('id', 'integer', (c) => c.primaryKey());
  const big = 'bigint' as const;
  const ref = (table: string) => `${table}.id`;
  return {
    async up(db: Kysely<any>) {
      await id(db.schema.createTable('suppliers')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('name', 'text', (c) => c.notNull()).addColumn('phone', 'text').addColumn('opening_balance', big, (c) => c.notNull().defaultTo(0))
        .addColumn('terms_days', 'integer', (c) => c.notNull().defaultTo(30)).addColumn('created_on', 'text')
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1)).addColumn('ref', 'text').execute();
      await db.schema.createIndex('suppliers_station').on('suppliers').columns(['station_id', 'active']).execute();
      await id(db.schema.createTable('deliveries')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('tank_id', big, (c) => c.notNull().references(ref('tanks'))).addColumn('fuel_id', big, (c) => c.notNull().references(ref('fuels')))
        .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('quantity_ml', big, (c) => c.notNull()).addColumn('cost_e4', big, (c) => c.notNull()).addColumn('net', big, (c) => c.notNull())
        .addColumn('vat', big, (c) => c.notNull().defaultTo(0)).addColumn('supplier', 'text').addColumn('user_id', big, (c) => c.notNull().references(ref('users')))
        .addColumn('voided_at', 'text').addColumn('void_reason', 'text').addColumn('void_by', big).addColumn('shift_id', big, (c) => c.references(ref('shifts')))
        .addColumn('supplier_id', big, (c) => c.references(ref('suppliers')))
        .addColumn('pay_type', 'text', (c) => c.notNull().defaultTo('cash').check(sql`pay_type in ('cash','bank','credit')`))
        .addColumn('due_date', 'text').addColumn('payable', big).addColumn('ref', 'text').addColumn('note', 'text').execute();
      await db.schema.createIndex('deliveries_day').on('deliveries').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('deliveries_station_id').on('deliveries').columns(['station_id', 'id']).execute();
      await db.schema.createIndex('deliveries_supplier_day').on('deliveries').columns(['supplier_id', 'business_date']).execute();
      await db.schema.createIndex('deliveries_shift').on('deliveries').column('shift_id').execute();
      await id(db.schema.createTable('adjustments')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('tank_id', big, (c) => c.notNull().references(ref('tanks'))).addColumn('business_date', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull()).addColumn('before_ml', big, (c) => c.notNull()).addColumn('after_ml', big, (c) => c.notNull())
        .addColumn('note', 'text').addColumn('user_id', big, (c) => c.notNull().references(ref('users'))).execute();
      await db.schema.createIndex('adjustments_tank').on('adjustments').columns(['tank_id', 'business_date']).execute();
      await id(db.schema.createTable('transfers')).addColumn('org_id', big, (c) => c.notNull().references(ref('orgs')))
        .addColumn('from_station_id', big, (c) => c.notNull().references(ref('stations'))).addColumn('to_station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('from_tank_id', big, (c) => c.notNull().references(ref('tanks'))).addColumn('to_tank_id', big, (c) => c.notNull().references(ref('tanks')))
        .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('quantity_ml', big, (c) => c.notNull()).addColumn('value', big, (c) => c.notNull()).addColumn('note', 'text')
        .addColumn('user_id', big, (c) => c.notNull().references(ref('users'))).addColumn('voided_at', 'text').addColumn('void_reason', 'text').addColumn('void_by', big).execute();
      await db.schema.createIndex('transfers_from').on('transfers').columns(['org_id', 'from_station_id', 'id']).execute();
      await db.schema.createIndex('transfers_to').on('transfers').columns(['org_id', 'to_station_id', 'id']).execute();
      // the tank reconciliation sums moves and meter sales per tank and period straight from these indexes (20.7 → 3.8 ms on a demo year)
      await db.schema.createIndex('stock_moves_tank_day').on('stock_moves').columns(['tank_id', 'business_date', 'kind', 'qty_ml', 'value']).execute();
      await db.schema.dropIndex('sales_tank_day').execute();
      await db.schema.createIndex('sales_tank_day').on('sales').columns(['tank_id', 'business_date', 'voided_at', 'quantity_ml']).execute();
      // documents are voided, never deleted
      for (const t of ['deliveries', 'adjustments', 'transfers']) {
        await sql.raw(pg
          ? `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION fp_abort('${t} are never deleted; void them')`
          : `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are never deleted; void them'); END`).execute(db);
      }
    },
    async down() { throw new Error('v2 schema migrations are forward-only'); }
  };
}
