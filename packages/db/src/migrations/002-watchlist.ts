import { type Kysely, sql } from 'kysely'

const ADDRESS = 'varchar(42)'
// uint256 needs 78 decimal digits.
const WEI = sql`numeric(78, 0)`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('watchlist')
    .addColumn('wallet_address', ADDRESS, (c) => c.notNull())
    .addColumn('contract_address', ADDRESS, (c) => c.notNull())
    .addColumn('auction_id', WEI, (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('watchlist_pkey', ['wallet_address', 'contract_address', 'auction_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('watchlist').execute()
}
