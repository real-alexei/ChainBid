import { sql, type Db } from '@chainbid/db'
import {
  auctionProjectedSchema,
  chainMessageSchema,
  TOPICS,
  type AuctionCancelledEvent,
  type AuctionCreatedEvent,
  type AuctionSettledEvent,
  type BidPlacedEvent,
  type ChainReorgEvent,
  type NftClaimedEvent,
  type NftDeliveryFailedEvent,
} from '@chainbid/shared'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs'
import { retry } from './retry.js'
import { DB, KAFKA } from './tokens.js'

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`

@Injectable()
export class ProjectionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProjectionService.name)
  private consumer!: Consumer
  private producer!: Producer

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KAFKA) private readonly kafka: Kafka,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Declares every topic the worker touches, and runs before the other
    // services bootstrap (provider order). The indexer declares chain.events
    // too, so either process can start first with broker auto-creation off.
    const admin = this.kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: Object.values(TOPICS).map((topic) => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      })),
    })
    await admin.disconnect()

    this.producer = this.kafka.producer()
    await this.producer.connect()

    this.consumer = this.kafka.consumer({ groupId: 'chainbid-projections' })
    // Retried because a freshly declared topic's metadata may not have
    // propagated within the broker yet.
    await retry(5, 2_000, async () => {
      await this.consumer.connect()
      await this.consumer.subscribe({ topic: TOPICS.chainEvents, fromBeginning: true })
      await this.consumer.run({
        eachMessage: async ({ message }) => this.handle(message),
      })
    })
    this.logger.log('consuming chain.events')
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.disconnect()
    await this.producer.disconnect()
    await this.db.destroy()
  }

  private async handle(message: KafkaMessage): Promise<void> {
    if (message.value === null) return

    // A malformed payload is dropped (retrying can never fix it); anything
    // after this point throws on failure so Kafka redelivers.
    let json: unknown
    try {
      json = JSON.parse(message.value.toString())
    } catch {
      this.logger.error('dropping message with invalid JSON')
      return
    }
    const parsed = chainMessageSchema.safeParse(json)
    if (!parsed.success) {
      this.logger.error(`dropping invalid event: ${parsed.error.message}`)
      return
    }

    const event = parsed.data
    // The reorg marker arrives after the orphaned events and before their
    // canonical replay, so rolling back here and letting the replay rebuild
    // is race-free. No auction.projected follows: the replayed events emit
    // their own as they land.
    if (event.type === 'ChainReorg') {
      await this.applyChainReorg(event)
      this.logger.warn(`ChainReorg: rolled back rows above block ${event.fromBlock}`)
      return
    }

    switch (event.type) {
      case 'AuctionCreated':
        await this.applyAuctionCreated(event)
        break
      case 'BidPlaced':
        await this.applyBidPlaced(event)
        break
      case 'AuctionSettled':
        await this.applyAuctionSettled(event)
        break
      case 'AuctionCancelled':
        await this.applyAuctionCancelled(event)
        break
      case 'NftDeliveryFailed':
        await this.applyNftDelivery(event, 'pending_claim')
        break
      case 'NftClaimed':
        await this.applyNftDelivery(event, 'claimed')
        break
    }

    // Emitted after the read model commit so downstream consumers (cache
    // invalidation, notifications) always read the projected state.
    await this.producer.send({
      topic: TOPICS.auctionProjected,
      messages: [
        {
          key: event.auctionId,
          value: JSON.stringify(
            auctionProjectedSchema.parse({
              type: event.type,
              contractAddress: event.contractAddress,
              auctionId: event.auctionId,
              blockNumber: event.blockNumber,
            }),
          ),
        },
      ],
    })
    this.logger.log(`${event.type} auction=${event.auctionId} block=${event.blockNumber}`)
  }

  private async applyAuctionCreated(event: AuctionCreatedEvent): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // Events for one auction can arrive in any order, so a row may already
      // exist: a stub from Settled/Cancelled or a redelivery. On conflict only
      // the descriptive columns are filled in — status and current_bid belong
      // to events that happened later and must survive. end_time grows
      // monotonically (anti-snipe extensions), hence GREATEST.
      await trx
        .insertInto('auctions')
        .values({
          contract_address: event.contractAddress,
          auction_id: event.auctionId,
          nft_contract_address: event.nft,
          token_id: event.tokenId,
          seller_address: event.seller,
          reserve_price: event.reservePrice,
          start_time: new Date(event.startTime * 1000),
          end_time: new Date(event.endTime * 1000),
          status: 'live',
          last_event_block: event.blockNumber,
          created_block: event.blockNumber,
        })
        .onConflict((oc) =>
          oc.columns(['contract_address', 'auction_id']).doUpdateSet({
            nft_contract_address: event.nft,
            token_id: event.tokenId,
            seller_address: event.seller,
            reserve_price: event.reservePrice,
            start_time: new Date(event.startTime * 1000),
            end_time: sql<Date>`GREATEST(auctions.end_time, ${new Date(event.endTime * 1000)})`,
            created_block: event.blockNumber,
          }),
        )
        .execute()

      // Picks up bids that outran this event.
      await this.refreshFromBids(trx, event.contractAddress, event.auctionId)
    })
  }

  private async applyChainReorg(event: ChainReorgEvent): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('bids')
        .where('contract_address', '=', event.contractAddress)
        .where('block_number', '>', String(event.fromBlock))
        .execute()

      // Auctions born above the fork point are dropped wholesale: if the
      // creation is canonical too, the replay re-inserts them.
      await trx
        .deleteFrom('auctions')
        .where('contract_address', '=', event.contractAddress)
        .where('created_block', '>', String(event.fromBlock))
        .execute()

      // Auctions merely touched above the fork point revert to what the
      // surviving bids say and lower their guard so replayed events at lower
      // block numbers apply again. end_time keeps a possibly-orphaned bid
      // extension — recovering it would mean storing it per bid; canonical
      // replayed bids re-set it.
      const touched = await trx
        .selectFrom('auctions')
        .select(['auction_id'])
        .where('contract_address', '=', event.contractAddress)
        .where('last_event_block', '>', String(event.fromBlock))
        .execute()

      for (const { auction_id } of touched) {
        const lastBid = await trx
          .selectFrom('bids')
          .select(['amount', 'bidder_address'])
          .where('contract_address', '=', event.contractAddress)
          .where('auction_id', '=', auction_id)
          .orderBy('block_number', 'desc')
          .orderBy('log_index', 'desc')
          .limit(1)
          .executeTakeFirst()

        await trx
          .updateTable('auctions')
          .set({
            status: 'live',
            winner_address: null,
            current_bid: lastBid?.amount ?? null,
            current_bidder_address: lastBid?.bidder_address ?? null,
            nft_delivery: null,
            nft_claimant_address: null,
            last_event_block: event.fromBlock,
            updated_at: new Date(),
          })
          .where('contract_address', '=', event.contractAddress)
          .where('auction_id', '=', auction_id)
          .execute()
      }
    })
  }

  private async applyBidPlaced(event: BidPlacedEvent): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // Append-only bid history; (tx_hash, log_index) makes redelivery a no-op.
      await trx
        .insertInto('bids')
        .values({
          contract_address: event.contractAddress,
          auction_id: event.auctionId,
          bidder_address: event.bidder,
          amount: event.amount,
          tx_hash: event.txHash,
          log_index: event.logIndex,
          block_number: event.blockNumber,
          block_time: new Date(event.blockTime * 1000),
        })
        .onConflict((oc) => oc.columns(['tx_hash', 'log_index']).doNothing())
        .execute()

      // The auction header is rebuilt from the bids table rather than from
      // this event, so bids arriving out of order converge on the same state.
      // The event carries endTime because a late bid may have extended the
      // auction.
      await this.refreshFromBids(
        trx,
        event.contractAddress,
        event.auctionId,
        new Date(event.endTime * 1000),
      )
    })
  }

  /**
   * Recomputes current_bid/current_bidder from the bids table — the bid with
   * the highest (block_number, log_index) wins regardless of arrival order.
   * end_time and last_event_block only ever move forward, so GREATEST keeps
   * stale events from rewinding them. A no-op when the auction row doesn't
   * exist yet (bid outran AuctionCreated): applyAuctionCreated re-runs this
   * once the row lands.
   */
  private async refreshFromBids(
    trx: Db,
    contractAddress: string,
    auctionId: string,
    endTime?: Date,
  ): Promise<void> {
    const lastBid = await trx
      .selectFrom('bids')
      .select(['amount', 'bidder_address', 'block_number'])
      .where('contract_address', '=', contractAddress)
      .where('auction_id', '=', auctionId)
      .orderBy('block_number', 'desc')
      .orderBy('log_index', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!lastBid) return

    await trx
      .updateTable('auctions')
      .set({
        current_bid: lastBid.amount,
        current_bidder_address: lastBid.bidder_address,
        last_event_block: sql<string>`GREATEST(last_event_block, ${lastBid.block_number})`,
        ...(endTime && { end_time: sql<Date>`GREATEST(end_time, ${endTime})` }),
        updated_at: new Date(),
      })
      .where('contract_address', '=', contractAddress)
      .where('auction_id', '=', auctionId)
      .execute()
  }

  private async applyAuctionSettled(event: AuctionSettledEvent): Promise<void> {
    const winner = event.winner === ZERO_ADDRESS ? null : event.winner
    await this.db
      .insertInto('auctions')
      .values(this.terminalStub(event, 'settled', winner))
      .onConflict((oc) =>
        oc
          .columns(['contract_address', 'auction_id'])
          .doUpdateSet({
            status: 'settled',
            winner_address: winner,
            last_event_block: event.blockNumber,
            updated_at: new Date(),
          })
          .where('last_event_block', '<=', String(event.blockNumber)),
      )
      .execute()
  }

  /**
   * NftDeliveryFailed downgrades settlement's push to a pull: the claimant
   * must call claimNft(), and NftClaimed marks that done. The upsert mirrors
   * the terminal events — a stub row absorbs an event that outran its
   * AuctionCreated (the Created upsert fills the placeholders in later), and
   * the last_event_block guard makes a redelivered pending_claim a no-op once
   * the higher-block claimed has landed.
   */
  private async applyNftDelivery(
    event: NftDeliveryFailedEvent | NftClaimedEvent,
    delivery: 'pending_claim' | 'claimed',
  ): Promise<void> {
    await this.db
      .insertInto('auctions')
      .values({
        contract_address: event.contractAddress,
        auction_id: event.auctionId,
        nft_contract_address: ZERO_ADDRESS,
        token_id: '0',
        seller_address: ZERO_ADDRESS,
        reserve_price: '0',
        start_time: new Date(0),
        end_time: new Date(0),
        nft_delivery: delivery,
        nft_claimant_address: event.claimant,
        last_event_block: event.blockNumber,
        created_block: event.blockNumber,
      })
      .onConflict((oc) =>
        oc
          .columns(['contract_address', 'auction_id'])
          .doUpdateSet({
            nft_delivery: delivery,
            nft_claimant_address: event.claimant,
            last_event_block: event.blockNumber,
            updated_at: new Date(),
          })
          .where('last_event_block', '<=', String(event.blockNumber)),
      )
      .execute()
  }

  private async applyAuctionCancelled(event: AuctionCancelledEvent): Promise<void> {
    await this.db
      .insertInto('auctions')
      .values(this.terminalStub(event, 'cancelled', null))
      .onConflict((oc) =>
        oc
          .columns(['contract_address', 'auction_id'])
          .doUpdateSet({
            status: 'cancelled',
            last_event_block: event.blockNumber,
            updated_at: new Date(),
          })
          .where('last_event_block', '<=', String(event.blockNumber)),
      )
      .execute()
  }

  /**
   * Insert values for a Settled/Cancelled event that outran its
   * AuctionCreated: the row pins the terminal status now, and the Created
   * upsert fills in the placeholder descriptive columns when it arrives.
   */
  private terminalStub(
    event: AuctionSettledEvent | AuctionCancelledEvent,
    status: 'settled' | 'cancelled',
    winner: string | null,
  ) {
    return {
      contract_address: event.contractAddress,
      auction_id: event.auctionId,
      nft_contract_address: ZERO_ADDRESS,
      token_id: '0',
      seller_address: event.seller,
      reserve_price: '0',
      start_time: new Date(0),
      end_time: new Date(0),
      status,
      winner_address: winner,
      last_event_block: event.blockNumber,
      created_block: event.blockNumber,
    }
  }
}
