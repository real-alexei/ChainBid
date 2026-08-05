import type { Db } from '@chainbid/db'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { Kafka, Producer } from 'kafkajs'
import { DB, KAFKA } from './tokens.js'

const POLL_INTERVAL_MS = 2_000
const BATCH_SIZE = 100

/**
 * Transactional-outbox relay: the api writes domain events into the outbox
 * table in the same transaction as the state change; this loop moves them to
 * Kafka. Publish happens before the mark, so a crash in between republishes
 * the batch (at-least-once) — consumers must tolerate duplicates.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name)
  private producer!: Producer
  private stopped = false
  private loop: Promise<void> = Promise.resolve()

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KAFKA) private readonly kafka: Kafka,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.producer = this.kafka.producer()
    await this.producer.connect()
    this.loop = this.run()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true
    await this.loop
    await this.producer.disconnect()
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let drained = true
      try {
        drained = await this.tick()
      } catch (err) {
        this.logger.error(`relay tick failed: ${String(err)}`)
      }
      if (drained) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  /** Returns true when the outbox is drained. */
  private async tick(): Promise<boolean> {
    const rows = await this.db
      .selectFrom('outbox')
      .selectAll()
      .where('published_at', 'is', null)
      .orderBy('id', 'asc')
      .limit(BATCH_SIZE)
      .execute()
    if (rows.length === 0) return true

    // The relay is deliberately schema-blind: payloads are validated where
    // they are written (api) and consumed (worker), not in transit.
    for (const row of rows) {
      await this.producer.send({
        topic: row.topic,
        messages: [{ key: row.event_key, value: JSON.stringify(row.payload) }],
      })
    }

    await this.db
      .updateTable('outbox')
      .set({ published_at: new Date() })
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .execute()

    this.logger.log(`relayed ${rows.length} outbox event(s)`)
    return rows.length < BATCH_SIZE
  }
}
