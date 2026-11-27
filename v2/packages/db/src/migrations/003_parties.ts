/* v2 schema, step 3 (phase 3: customers, suppliers & collections): customer payments and supplier payments.
   Same column names as v1 (src/db.js). */
import { sql, type Kysely, type CreateTableBuilder } from 'kysely';
import type { Dialect } from '@fuelpro/core';

export function m003(dialect: Dialect) {
  const pg = dialect === 'postgres';
  const id = <T extends string>(t: CreateTableBuilder<T, never>) => pg
    ? t.addColumn('id', 'bigint', (c) => c.primaryKey().generatedByDefaultAsIdentity())
    : t.addColumn('id', 'integer', (c) => c.primaryKey());
  const big = 'bigint' as const;
  const ref = (table: string) => `${table}.id`;
  const doc = <T extends string>(t: CreateTableBuilder<T, never>) => t
    .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('amount', big, (c) => c.notNull().check(sql`amount > 0`)).addColumn('note', 'text')
    .addColumn('user_id', big, (c) => c.notNull().references(ref('users'))).addColumn('voided_at', 'text').addColumn('void_reason', 'text').addColumn('void_by', big)
    .addColumn('shift_id', big, (c) => c.references(ref('shifts'))).addColumn('method', 'text', (c) => c.notNull().defaultTo('cash').check(sql`method in ('cash','bank')`));
  return {
    async up(db: Kysely<any>) {
      await doc(id(db.schema.createTable('payments')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('customer_id', big, (c) => c.notNull().references(ref('customers')))).execute();
      await db.schema.createIndex('payments_customer').on('payments').columns(['customer_id', 'business_date']).execute();
      await db.schema.createIndex('payments_station').on('payments').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('payments_shift').on('payments').column('shift_id').execute();
      await doc(id(db.schema.createTable('supplier_payments')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('supplier_id', big, (c) => c.notNull().references(ref('suppliers')))).execute();
      await db.schema.createIndex('supplier_payments_sup').on('supplier_payments').columns(['supplier_id', 'business_date']).execute();
      await db.schema.createIndex('supplier_payments_station').on('supplier_payments').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('supplier_payments_shift').on('supplier_payments').column('shift_id').execute();
      // statements and ageing read a party's ledger lines by party then date
      await db.schema.createIndex('sales_customer_day').on('sales').columns(['customer_id', 'business_date']).execute();
      for (const t of ['payments', 'supplier_payments']) {
        await sql.raw(pg
          ? `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION fp_abort('${t} are never deleted; void them')`
          : `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are never deleted; void them'); END`).execute(db);
      }
    },
    async down() { throw new Error('v2 schema migrations are forward-only'); }
  };
}
