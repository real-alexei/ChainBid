import { type Kysely, sql } from 'kysely'

const ADDRESS = 'varchar(42)'
const HASH = 'varchar(66)'
// uint256 needs 78 decimal digits.
const WEI = sql`numeric(78, 0)`

export async function up(db: Kysely<unknown>): Promise<void> {
  // A real enum rather than varchar + check: the type then reaches TypeScript
  // through codegen as a union instead of a bare string.
  await db.schema
    .createType('auction_status')
    .asEnum(['created', 'live', 'settled', 'cancelled'])
    .execute()

  await db.schema
    .createTable('users')
    .addColumn('wallet_address', ADDRESS, (c) => c.primaryKey())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('nfts')
    .addColumn('contract_address', ADDRESS, (c) => c.notNull())
    .addColumn('token_id', WEI, (c) => c.notNull())
    .addColumn('owner_address', ADDRESS)
    .addColumn('token_uri', 'text')
    .addColumn('metadata', 'jsonb')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('nfts_pkey', ['contract_address', 'token_id'])
    .execute()

  await db.schema
    .createTable('auctions')
    .addColumn('auction_id', WEI, (c) => c.notNull())
    .addColumn('contract_address', ADDRESS, (c) => c.notNull())
    .addColumn('nft_contract_address', ADDRESS, (c) => c.notNull())
    .addColumn('token_id', WEI, (c) => c.notNull())
    .addColumn('seller_address', ADDRESS, (c) => c.notNull())
    .addColumn('reserve_price', WEI, (c) => c.notNull())
    .addColumn('start_time', 'timestamptz', (c) => c.notNull())
    .addColumn('end_time', 'timestamptz', (c) => c.notNull())
    .addColumn('status', sql`auction_status`, (c) => c.notNull().defaultTo('created'))
    .addColumn('current_bid', WEI)
    .addColumn('current_bidder_address', ADDRESS)
    .addColumn('winner_address', ADDRESS)
    .addColumn('last_event_block', 'bigint', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // The auction contract's own id is unique per deployment, so key on both.
    .addPrimaryKeyConstraint('auctions_pkey', ['contract_address', 'auction_id'])
    .execute()

  await db.schema
    .createIndex('auctions_status_end_time_idx')
    .on('auctions')
    .columns(['status', 'end_time'])
    .execute()

  await db.schema
    .createIndex('auctions_seller_idx')
    .on('auctions')
    .column('seller_address')
    .execute()

  await db.schema
    .createTable('bids')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('auction_id', WEI, (c) => c.notNull())
    .addColumn('contract_address', ADDRESS, (c) => c.notNull())
    .addColumn('bidder_address', ADDRESS, (c) => c.notNull())
    .addColumn('amount', WEI, (c) => c.notNull())
    .addColumn('tx_hash', HASH, (c) => c.notNull())
    .addColumn('log_index', 'integer', (c) => c.notNull())
    .addColumn('block_number', 'bigint', (c) => c.notNull())
    .addColumn('block_time', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Idempotency: a log is identified by where it happened, so a redelivered
    // event collides here instead of duplicating a bid.
    .addUniqueConstraint('bids_log_unique', ['tx_hash', 'log_index'])
    .execute()

  await db.schema
    .createIndex('bids_auction_idx')
    .on('bids')
    .columns(['contract_address', 'auction_id', 'block_number'])
    .execute()

  await db.schema.createIndex('bids_bidder_idx').on('bids').column('bidder_address').execute()

  await db.schema
    .createTable('indexer_state')
    .addColumn('contract_address', ADDRESS, (c) => c.primaryKey())
    .addColumn('last_block_number', 'bigint', (c) => c.notNull())
    .addColumn('last_block_hash', HASH, (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('outbox')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('topic', 'varchar(128)', (c) => c.notNull())
    .addColumn('event_key', 'varchar(128)', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('published_at', 'timestamptz')
    .execute()

  // The relay only ever scans for unpublished rows, so index just those.
  await db.schema
    .createIndex('outbox_unpublished_idx')
    .on('outbox')
    .column('id')
    .where(sql.ref('published_at'), 'is', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('outbox').ifExists().execute()
  await db.schema.dropTable('indexer_state').ifExists().execute()
  await db.schema.dropTable('bids').ifExists().execute()
  await db.schema.dropTable('auctions').ifExists().execute()
  await db.schema.dropTable('nfts').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
  await db.schema.dropType('auction_status').ifExists().execute()
}
