import type { Db } from '@chainbid/db'
import { chainEventSchema, ENGLISH_AUCTION_EVENTS, TOPICS, type ChainEvent } from '@chainbid/shared'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { Interface, JsonRpcProvider, type Log } from 'ethers'
import type { Kafka, Producer } from 'kafkajs'
import { DB, KAFKA } from './tokens.js'
import { ENV, type Env } from './env.js'

const POLL_INTERVAL_MS = 2_000
const MAX_BLOCK_RANGE = 1_000

interface Cursor {
  blockNumber: number
  blockHash: string
}

@Injectable()
export class IndexerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IndexerService.name)
  private readonly iface = new Interface([...ENGLISH_AUCTION_EVENTS])
  private readonly provider: JsonRpcProvider
  private producer!: Producer
  private stopped = false
  private loop: Promise<void> = Promise.resolve()

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(KAFKA) private readonly kafka: Kafka,
  ) {
    this.provider = new JsonRpcProvider(env.rpcUrl)
  }

  async onApplicationBootstrap(): Promise<void> {
    // Auto-creation is off broker-side, so the producer declares its topic.
    const admin = this.kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic: TOPICS.chainEvents, numPartitions: 1, replicationFactor: 1 }],
    })
    await admin.disconnect()

    this.producer = this.kafka.producer()
    await this.producer.connect()

    this.logger.log(`indexing ${this.env.auctionAddress} from ${this.env.rpcUrl}`)
    this.loop = this.run()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true
    await this.loop
    await this.producer.disconnect()
    await this.db.destroy()
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let caughtUp = true
      try {
        caughtUp = await this.tick()
      } catch (err) {
        this.logger.error(`tick failed: ${String(err)}`)
      }
      if (caughtUp) await sleep(POLL_INTERVAL_MS)
    }
  }

  /** Returns true when the cursor is caught up with the confirmed head. */
  private async tick(): Promise<boolean> {
    const cursor = await this.loadCursor()

    // Reorg check: the block we last processed must still be on the canonical
    // chain. With a confirmation depth this fires only on reorgs deeper than
    // that depth; rewinding re-emits the range and consumers converge because
    // every projection is idempotent.
    if (cursor !== null) {
      const stored = await this.provider.getBlock(cursor.blockNumber)
      if (stored === null || stored.hash !== cursor.blockHash) {
        await this.rewind(cursor)
        return false
      }
    }

    const head = await this.provider.getBlockNumber()
    const target = head - this.env.confirmations
    const from = cursor === null ? 0 : cursor.blockNumber + 1
    if (target < from) return true

    const to = Math.min(target, from + MAX_BLOCK_RANGE - 1)
    const logs = await this.provider.getLogs({
      address: this.env.auctionAddress,
      fromBlock: from,
      toBlock: to,
    })

    const events = await this.toEvents(logs)
    if (events.length > 0) {
      await this.producer.send({
        topic: TOPICS.chainEvents,
        messages: events.map((event) => ({ key: event.auctionId, value: JSON.stringify(event) })),
      })
      this.logger.log(`published ${events.length} event(s) from blocks ${from}-${to}`)
    }

    const toBlock = await this.provider.getBlock(to)
    if (toBlock === null || toBlock.hash === null) {
      throw new Error(`block ${to} disappeared mid-tick`)
    }
    // Publish first, save the cursor after: a crash in between replays the
    // range on restart (at-least-once), which idempotent consumers absorb.
    await this.saveCursor(to, toBlock.hash)
    return to === target
  }

  private async toEvents(logs: Log[]): Promise<ChainEvent[]> {
    const blockTimes = new Map<number, number>()
    const events: ChainEvent[] = []

    for (const log of logs) {
      // Unknown fragments (e.g. RefundWithdrawn, which is not auction-scoped)
      // parse to null and are skipped.
      const parsed = this.iface.parseLog(log)
      if (parsed === null) continue

      let blockTime = blockTimes.get(log.blockNumber)
      if (blockTime === undefined) {
        const block = await this.provider.getBlock(log.blockNumber)
        if (block === null) throw new Error(`block ${log.blockNumber} disappeared mid-tick`)
        blockTime = block.timestamp
        blockTimes.set(log.blockNumber, blockTime)
      }

      const args = parsed.args
      const envelope = {
        contractAddress: log.address.toLowerCase(),
        auctionId: String(args['auctionId']),
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        blockTime,
        txHash: log.transactionHash,
        logIndex: log.index,
      }

      switch (parsed.name) {
        case 'AuctionCreated':
          events.push(
            chainEventSchema.parse({
              ...envelope,
              type: 'AuctionCreated',
              seller: String(args['seller']).toLowerCase(),
              nft: String(args['nft']).toLowerCase(),
              tokenId: String(args['tokenId']),
              reservePrice: String(args['reservePrice']),
              startTime: Number(args['startTime']),
              endTime: Number(args['endTime']),
            }),
          )
          break
        case 'BidPlaced':
          events.push(
            chainEventSchema.parse({
              ...envelope,
              type: 'BidPlaced',
              bidder: String(args['bidder']).toLowerCase(),
              amount: String(args['amount']),
              previousBidder: String(args['previousBidder']).toLowerCase(),
              previousBid: String(args['previousBid']),
              endTime: Number(args['endTime']),
            }),
          )
          break
        case 'AuctionSettled':
          events.push(
            chainEventSchema.parse({
              ...envelope,
              type: 'AuctionSettled',
              winner: String(args['winner']).toLowerCase(),
              amount: String(args['amount']),
              seller: String(args['seller']).toLowerCase(),
            }),
          )
          break
        case 'AuctionCancelled':
          events.push(
            chainEventSchema.parse({
              ...envelope,
              type: 'AuctionCancelled',
              seller: String(args['seller']).toLowerCase(),
            }),
          )
          break
      }
    }

    return events
  }

  private async rewind(cursor: Cursor): Promise<void> {
    const rewound = Math.max(cursor.blockNumber - this.env.confirmations, 0)
    const block = await this.provider.getBlock(rewound)
    if (block === null || block.hash === null) {
      throw new Error(`cannot rewind: block ${rewound} not available`)
    }
    await this.saveCursor(rewound, block.hash)
    this.logger.warn(`reorg at block ${cursor.blockNumber}, cursor rewound to ${rewound}`)
  }

  private async loadCursor(): Promise<Cursor | null> {
    const row = await this.db
      .selectFrom('indexer_state')
      .select(['last_block_number', 'last_block_hash'])
      .where('contract_address', '=', this.env.auctionAddress)
      .executeTakeFirst()
    if (row === undefined) return null
    return { blockNumber: Number(row.last_block_number), blockHash: row.last_block_hash }
  }

  private async saveCursor(blockNumber: number, blockHash: string): Promise<void> {
    await this.db
      .insertInto('indexer_state')
      .values({
        contract_address: this.env.auctionAddress,
        last_block_number: blockNumber,
        last_block_hash: blockHash,
      })
      .onConflict((oc) =>
        oc.column('contract_address').doUpdateSet({
          last_block_number: blockNumber,
          last_block_hash: blockHash,
          updated_at: new Date(),
        }),
      )
      .execute()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
