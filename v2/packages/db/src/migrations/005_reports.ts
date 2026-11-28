/* v2 schema, step 5 (phase 5: financial reports & printing): the organisation's letterhead (name, activity, address,
   phones, footer, logo as a data: URL) printed at the top and bottom of every document. Same columns as v1 org_brand.
   The reports themselves add no tables: every figure is summed from the journals at the time it is asked for (ADR-23). */
import type { Kysely } from 'kysely';
import type { Dialect } from '@fuelpro/core';

export function m005(_dialect: Dialect) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.createTable('org_brand').addColumn('org_id', 'bigint', (c) => c.primaryKey().references('orgs.id'))
        .addColumn('name', 'text').addColumn('activity', 'text').addColumn('address', 'text').addColumn('phones', 'text').addColumn('footer', 'text')
        .addColumn('logo', 'text').addColumn('updated_at', 'text').execute();
    },
    async down(db: Kysely<any>) { await db.schema.dropTable('org_brand').execute(); }
  };
}
