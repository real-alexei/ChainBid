import type { AuctionRow, AuctionStatus, BidRow, Db } from '@chainbid/db'
import { CACHE_KEYS, toAuctionSnapshot, type AuctionSnapshot } from '@chainbid/shared'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { DB, REDIS, type RedisClient } from '../infra.module.js'

// The worker invalidates these keys on every projected event; the TTL is only
// a safety net for a missed invalidation.
const CACHE_TTL_SECONDS = 10

export interface AuctionConnection {
  nodes: AuctionSnapshot[]
  endCursor: string | null
  hasNextPage: boolean
}

@Injectable()
export class AuctionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async list(status?: AuctionStatus): Promise<AuctionSnapshot[]> {
    return this.cached(CACHE_KEYS.auctionList(status), async () => {
      let query = this.db.selectFrom('auctions').selectAll().orderBy('end_time', 'asc').limit(100)
      if (status !== undefined) query = query.where('status', '=', status)
      const rows = await query.execute()
      return rows.map(toAuctionSnapshot)
    })
  }

  /** Cursor-paginated variant for GraphQL; keyset on (end_time, contract_address, auction_id). */
  async listConnection(
    status: AuctionStatus | undefined,
    first: number,
    after?: string,
  ): Promise<AuctionConnection> {
    let query = this.db
      .selectFrom('auctions')
      .selectAll()
      .orderBy('end_time', 'asc')
      .orderBy('contract_address', 'asc')
      .orderBy('auction_id', 'asc')
      .limit(first + 1)
    if (status !== undefined) query = query.where('status', '=', status)
    if (after !== undefined) {
      const cursor = decodeCursor(after)
      query = query.where((eb) =>
        eb.or([
          eb('end_time', '>', cursor.endTime),
          eb.and([
            eb('end_time', '=', cursor.endTime),
            eb('contract_address', '>', cursor.contractAddress),
          ]),
          eb.and([
            eb('end_time', '=', cursor.endTime),
            eb('contract_address', '=', cursor.contractAddress),
            eb('auction_id', '>', cursor.auctionId),
          ]),
        ]),
      )
    }

    const rows = await query.execute()
    const nodes = rows.slice(0, first)
    const last = nodes.at(-1)
    return {
      nodes: nodes.map(toAuctionSnapshot),
      endCursor: last === undefined ? null : encodeCursor(last),
      hasNextPage: rows.length > first,
    }
  }

  // auctionId alone is ambiguous — each contract deployment numbers its
  // auctions from 1 — so both lookups take the full (contract, id) identity.
  async byId(contractAddress: string, auctionId: string): Promise<AuctionSnapshot> {
    const contract = contractAddress.toLowerCase()
    const snapshot = await this.cached(CACHE_KEYS.auction(contract, auctionId), async () => {
      const row = await this.db
        .selectFrom('auctions')
        .selectAll()
        .where('contract_address', '=', contract)
        .where('auction_id', '=', auctionId)
        .executeTakeFirst()
      return row === undefined ? null : toAuctionSnapshot(row)
    })
    if (snapshot === null) {
      throw new NotFoundException(`auction ${contract}/${auctionId} not found`)
    }
    return snapshot
  }

  async bids(contractAddress: string, auctionId: string): Promise<BidDto[]> {
    await this.byId(contractAddress, auctionId)
    const rows = await this.db
      .selectFrom('bids')
      .selectAll()
      .where('contract_address', '=', contractAddress.toLowerCase())
      .where('auction_id', '=', auctionId)
      .orderBy('block_number', 'desc')
      .orderBy('log_index', 'desc')
      .execute()
    return rows.map(toBidDto)
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(key)
    if (hit !== null) return JSON.parse(hit) as T
    const value = await load()
    await this.redis.set(key, JSON.stringify(value), { EX: CACHE_TTL_SECONDS })
    return value
  }
}

export interface BidDto {
  auctionId: string
  bidder: string
  amount: string
  txHash: string
  blockNumber: number
  blockTime: string
}

function toBidDto(row: BidRow): BidDto {
  return {
    auctionId: row.auction_id,
    bidder: row.bidder_address,
    amount: row.amount,
    txHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    blockTime: row.block_time.toISOString(),
  }
}

function encodeCursor(row: AuctionRow): string {
  return Buffer.from(
    `${row.end_time.toISOString()}|${row.contract_address}|${row.auction_id}`,
  ).toString('base64url')
}

function decodeCursor(after: string): {
  endTime: Date
  contractAddress: string
  auctionId: string
} {
  const [iso, contractAddress, auctionId] = Buffer.from(after, 'base64url').toString().split('|')
  const endTime = new Date(iso ?? '')
  if (
    Number.isNaN(endTime.getTime()) ||
    contractAddress === undefined ||
    !/^0x[0-9a-f]{40}$/.test(contractAddress) ||
    auctionId === undefined ||
    !/^\d+$/.test(auctionId)
  ) {
    throw new BadRequestException('malformed cursor')
  }
  return { endTime, contractAddress, auctionId }
}
