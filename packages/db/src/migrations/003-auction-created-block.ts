import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Reorg handling deletes auctions whose AuctionCreated sat above the fork
  // point, which requires knowing the creating block. Default 0 for rows that
  // predate this column: they can never be deleted by a rollback, only reset.
  await db.schema
    .alterTable('auctions')
    .addColumn('created_block', 'bigint', (c) => c.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('auctions').dropColumn('created_block').execute()
}
