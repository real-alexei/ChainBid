import type { Db } from '@chainbid/db'
import {
  ALL_AUCTION_LIST_KEYS,
  AUCTION_UPDATE_EVENTS,
  auctionProjectedSchema,
  auctionUpdateSchema,
  CACHE_KEYS,
  outboxEventSchema,
  REDIS_CHANNELS,
  toAuctionSnapshot,
  TOPICS,
} from '@chainbid/shared'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { Consumer, Kafka, KafkaMessage } from 'kafkajs'
import type { RedisClient } from './app.module.js'
import { retry } from './retry.js'
import { DB, KAFKA, REDIS } from './tokens.js'

/**
 * Consumes auction.projected, drops the stale cache entries, and fans the
 * fresh snapshot out to the api instances over Redis pub/sub. Invalidation
 * and notification are separate concerns sharing one consumer — a second
 * group would buy nothing at this scale.
 */
@Injectable()
export class NotifierService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotifierService.name)
  private consumer!: Consumer

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId: 'chainbid-notifier' })
    // Retried because the topics may have been declared moments ago and their
    // metadata not yet propagated within the broker.
    await retry(5, 2_000, async () => {
      await this.consumer.connect()
      await this.consumer.subscribe({ topics: [TOPICS.auctionProjected, TOPICS.outboxEvents] })
      await this.consumer.run({
        eachMessage: async ({ topic, message }) => this.handle(topic, message),
      })
    })
    this.logger.log('consuming auction.projected and outbox.events')
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.disconnect()
  }

  private async handle(topic: string, message: KafkaMessage): Promise<void> {
    if (message.value === null) return
    let json: unknown
    try {
      json = JSON.parse(message.value.toString())
    } catch {
      this.logger.error('dropping message with invalid JSON')
      return
    }

    if (topic === TOPICS.outboxEvents) {
      this.handleOutboxEvent(json)
      return
    }

    const parsed = auctionProjectedSchema.safeParse(json)
    if (!parsed.success) {
      this.logger.error(`dropping invalid event: ${parsed.error.message}`)
      return
    }
    const { type, contractAddress, auctionId } = parsed.data

    await this.redis.del([CACHE_KEYS.auction(auctionId), ...ALL_AUCTION_LIST_KEYS])

    const row = await this.db
      .selectFrom('auctions')
      .selectAll()
      .where('contract_address', '=', contractAddress)
      .where('auction_id', '=', auctionId)
      .executeTakeFirst()
    if (row === undefined) return

    const update = auctionUpdateSchema.parse({
      event: AUCTION_UPDATE_EVENTS[type],
      auction: toAuctionSnapshot(row),
    })
    await this.redis.publish(REDIS_CHANNELS.auctionUpdates, JSON.stringify(update))
    this.logger.log(`published ${update.event} auction=${auctionId}`)
  }

  // A real delivery channel (email, push) would hang off this handler; the
  // demo stops at proving the event arrived through the outbox.
  private handleOutboxEvent(json: unknown): void {
    const parsed = outboxEventSchema.safeParse(json)
    if (!parsed.success) {
      this.logger.error(`dropping invalid outbox event: ${parsed.error.message}`)
      return
    }
    const event = parsed.data
    this.logger.log(`${event.type} wallet=${event.wallet} auction=${event.auctionId}`)
  }
}
