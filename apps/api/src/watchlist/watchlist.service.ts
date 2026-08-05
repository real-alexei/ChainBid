import type { Db } from '@chainbid/db'
import {
  TOPICS,
  toAuctionSnapshot,
  watchlistEventSchema,
  type AuctionSnapshot,
  type WatchlistEvent,
} from '@chainbid/shared'
import { Inject, Injectable } from '@nestjs/common'
import { DB } from '../infra.module.js'

@Injectable()
export class WatchlistService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The watchlist row and the outbox event commit in one transaction — the
   * outbox pattern's whole point: either both happen or neither does. The
   * event is only written when the row actually changed, so re-watching an
   * already-watched auction emits nothing.
   */
  async watch(wallet: string, contractAddress: string, auctionId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .insertInto('watchlist')
        .values({
          wallet_address: wallet,
          contract_address: contractAddress,
          auction_id: auctionId,
        })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst()
      if (result.numInsertedOrUpdatedRows === 0n) return
      await this.enqueue(trx, {
        type: 'watchlist.added',
        wallet,
        contractAddress,
        auctionId,
      })
    })
  }

  async unwatch(wallet: string, contractAddress: string, auctionId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .deleteFrom('watchlist')
        .where('wallet_address', '=', wallet)
        .where('contract_address', '=', contractAddress)
        .where('auction_id', '=', auctionId)
        .executeTakeFirst()
      if (result.numDeletedRows === 0n) return
      await this.enqueue(trx, {
        type: 'watchlist.removed',
        wallet,
        contractAddress,
        auctionId,
      })
    })
  }

  async list(wallet: string): Promise<AuctionSnapshot[]> {
    const rows = await this.db
      .selectFrom('watchlist')
      .innerJoin('auctions', (join) =>
        join
          .onRef('auctions.contract_address', '=', 'watchlist.contract_address')
          .onRef('auctions.auction_id', '=', 'watchlist.auction_id'),
      )
      .selectAll('auctions')
      .where('watchlist.wallet_address', '=', wallet)
      .orderBy('watchlist.created_at', 'desc')
      .execute()
    return rows.map(toAuctionSnapshot)
  }

  private async enqueue(trx: Db, event: WatchlistEvent): Promise<void> {
    await trx
      .insertInto('outbox')
      .values({
        topic: TOPICS.outboxEvents,
        event_key: event.wallet,
        payload: JSON.stringify(watchlistEventSchema.parse(event)),
      })
      .execute()
  }
}
