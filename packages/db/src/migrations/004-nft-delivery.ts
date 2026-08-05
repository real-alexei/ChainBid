import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Null means the token moved with settlement (or the auction is not settled
  // yet); pending_claim mirrors the contract's nftClaimant mapping until the
  // claimant pulls the token and NftClaimed flips it to claimed.
  await db.schema.createType('nft_delivery_status').asEnum(['pending_claim', 'claimed']).execute()

  await db.schema
    .alterTable('auctions')
    .addColumn('nft_delivery', sql`nft_delivery_status`)
    .execute()

  await db.schema.alterTable('auctions').addColumn('nft_claimant_address', 'varchar(42)').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('auctions').dropColumn('nft_claimant_address').execute()
  await db.schema.alterTable('auctions').dropColumn('nft_delivery').execute()
  await db.schema.dropType('nft_delivery_status').ifExists().execute()
}
