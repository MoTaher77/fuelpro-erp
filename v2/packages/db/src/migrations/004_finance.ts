/* v2 schema, step 4 (phase 4: finance): expenses, cash moves (drawer ↔ bank / owner), receipt & payment vouchers.
   Same column names as v1 (src/db.js). Foreign-currency boxes (fc_* columns) are kept for the move of v1 data;
   v2 posts base-currency vouchers only until the currencies module is ported. */
import { sql, type Kysely, type CreateTableBuilder } from 'kysely';
import type { Dialect } from '@fuelpro/core';

export function m004(dialect: Dialect) {
  const pg = dialect === 'postgres';
  const id = <T extends string>(t: CreateTableBuilder<T, never>) => pg
    ? t.addColumn('id', 'bigint', (c) => c.primaryKey().generatedByDefaultAsIdentity())
    : t.addColumn('id', 'integer', (c) => c.primaryKey());
  const big = 'bigint' as const;
  const ref = (table: string) => `${table}.id`;
  const voidable = <T extends string>(t: CreateTableBuilder<T, never>) => t.addColumn('voided_at', 'text').addColumn('void_reason', 'text').addColumn('void_by', big);
  return {
    async up(db: Kysely<any>) {
      await voidable(id(db.schema.createTable('expenses')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull()).addColumn('category', 'text', (c) => c.notNull())
        .addColumn('gross', big, (c) => c.notNull().check(sql`gross > 0`)).addColumn('vat', big, (c) => c.notNull().defaultTo(0)).addColumn('note', 'text')
        .addColumn('user_id', big, (c) => c.notNull().references(ref('users'))))
        .addColumn('shift_id', big, (c) => c.references(ref('shifts'))).addColumn('method', 'text', (c) => c.notNull().defaultTo('cash').check(sql`method in ('cash','bank')`)).execute();
      await db.schema.createIndex('expenses_day').on('expenses').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('expenses_shift').on('expenses').column('shift_id').execute();
      await voidable(id(db.schema.createTable('cash_moves')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('shift_id', big, (c) => c.notNull().references(ref('shifts'))).addColumn('business_date', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull()).addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('withdrawal','deposit')`))
        .addColumn('counterpart', 'text', (c) => c.notNull().check(sql`counterpart in ('bank','owner')`)).addColumn('amount', big, (c) => c.notNull().check(sql`amount > 0`))
        .addColumn('note', 'text').addColumn('user_id', big, (c) => c.notNull().references(ref('users')))).execute();
      await db.schema.createIndex('cash_moves_shift').on('cash_moves').column('shift_id').execute();
      await voidable(id(db.schema.createTable('vouchers')).addColumn('station_id', big, (c) => c.notNull().references(ref('stations')))
        .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('receipt','payment')`)).addColumn('ref_no', 'text')
        .addColumn('business_date', 'text', (c) => c.notNull()).addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('box_account_id', big, (c) => c.notNull().references(ref('accounts'))).addColumn('amount', big, (c) => c.notNull())
        .addColumn('memo', 'text').addColumn('shift_id', big, (c) => c.references(ref('shifts'))).addColumn('user_id', big, (c) => c.notNull().references(ref('users'))))
        .addColumn('fc_code', 'text').addColumn('fc_rate_e6', big).addColumn('fc_amount', big).execute();
      await db.schema.createIndex('vouchers_day').on('vouchers').columns(['station_id', 'business_date']).execute();
      await db.schema.createIndex('vouchers_shift').on('vouchers').column('shift_id').execute();
      await db.schema.createIndex('vouchers_ref').on('vouchers').columns(['station_id', 'kind', 'ref_no']).execute();
      await id(db.schema.createTable('voucher_lines')).addColumn('voucher_id', big, (c) => c.notNull().references(ref('vouchers')))
        .addColumn('account_id', big, (c) => c.notNull().references(ref('accounts'))).addColumn('party_type', 'text').addColumn('party_id', big)
        .addColumn('amount', big, (c) => c.notNull()).addColumn('memo', 'text').addColumn('fc_amount', big).execute();
      await db.schema.createIndex('voucher_lines_voucher').on('voucher_lines').column('voucher_id').execute();
      // journals: drafts by date (period lock refuses while drafts wait), the journal list by station and date
      await db.schema.createIndex('journals_status_day').on('journals').columns(['org_id', 'status', 'business_date']).execute();
      for (const t of ['expenses', 'cash_moves', 'vouchers', 'voucher_lines']) {
        await sql.raw(pg
          ? `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION fp_abort('${t} are never deleted; void them')`
          : `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are never deleted; void them'); END`).execute(db);
      }
    },
    async down() { throw new Error('v2 schema migrations are forward-only'); }
  };
}
