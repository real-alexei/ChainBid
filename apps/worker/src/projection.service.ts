import type { Db } from '@chainbid/db'
import {
  chainEventSchema,
  TOPICS,
  type AuctionCancelledEvent,
  type AuctionCreatedEvent,
  type AuctionSettledEvent,
  type BidPlacedEvent,
} from '@chainbid/shared'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { Consumer, Kafka, KafkaMessage } from 'kafkajs'
import { DB, KAFKA } from './tokens.js'

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`

@Injectable()
export class ProjectionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProjectionService.name)
  private consumer!: Consumer

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KAFKA) private readonly kafka: Kafka,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // The indexer declares this topic too; declaring it in both places lets
    // either service start first with broker auto-creation off.
    const admin = this.kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: TOPICS.chainEvents, numPartitions: 1, replicationFactor: 1 }],
    })
    await admin.disconnect()

    this.consumer = this.kafka.consumer({ groupId: 'chainbid-projections' })
    await this.consumer.connect()
    await this.consumer.subscribe({ topic: TOPICS.chainEvents, fromBeginning: true })
    await this.consumer.run({
      eachMessage: async ({ message }) => this.handle(message),
    })
    this.logger.log('consuming chain.events')
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.disconnect()
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
    const parsed = chainEventSchema.safeParse(json)
    if (!parsed.success) {
      this.logger.error(`dropping invalid event: ${parsed.error.message}`)
      return
    }

    const event = parsed.data
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
    }
    this.logger.log(`${event.type} auction=${event.auctionId} block=${event.blockNumber}`)
  }

  private async applyAuctionCreated(event: AuctionCreatedEvent): Promise<void> {
    await this.db
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
      })
      .onConflict((oc) => oc.columns(['contract_address', 'auction_id']).doNothing())
      .execute()
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

      // last_event_block guards against an older replayed event overwriting a
      // newer projection. The event carries endTime because a late bid may
      // have extended the auction.
      await trx
        .updateTable('auctions')
        .set({
          current_bid: event.amount,
          current_bidder_address: event.bidder,
          end_time: new Date(event.endTime * 1000),
          last_event_block: event.blockNumber,
          updated_at: new Date(),
        })
        .where('contract_address', '=', event.contractAddress)
        .where('auction_id', '=', event.auctionId)
        .where('last_event_block', '<=', String(event.blockNumber))
        .execute()
    })
  }

  private async applyAuctionSettled(event: AuctionSettledEvent): Promise<void> {
    await this.db
      .updateTable('auctions')
      .set({
        status: 'settled',
        winner_address: event.winner === ZERO_ADDRESS ? null : event.winner,
        last_event_block: event.blockNumber,
        updated_at: new Date(),
      })
      .where('contract_address', '=', event.contractAddress)
      .where('auction_id', '=', event.auctionId)
      .where('last_event_block', '<=', String(event.blockNumber))
      .execute()
  }

  private async applyAuctionCancelled(event: AuctionCancelledEvent): Promise<void> {
    await this.db
      .updateTable('auctions')
      .set({
        status: 'cancelled',
        last_event_block: event.blockNumber,
        updated_at: new Date(),
      })
      .where('contract_address', '=', event.contractAddress)
      .where('auction_id', '=', event.auctionId)
      .where('last_event_block', '<=', String(event.blockNumber))
      .execute()
  }
}
