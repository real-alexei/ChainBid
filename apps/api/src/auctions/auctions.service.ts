import type { AuctionRow, AuctionStatus, BidRow, Db } from '@chainbid/db'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { DB } from '../infra.module.js'

@Injectable()
export class AuctionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(status?: AuctionStatus): Promise<AuctionDto[]> {
    let query = this.db.selectFrom('auctions').selectAll().orderBy('end_time', 'asc').limit(100)
    if (status !== undefined) query = query.where('status', '=', status)
    const rows = await query.execute()
    return rows.map(toAuctionDto)
  }

  async byId(auctionId: string): Promise<AuctionDto> {
    const row = await this.db
      .selectFrom('auctions')
      .selectAll()
      .where('auction_id', '=', auctionId)
      .executeTakeFirst()
    if (row === undefined) throw new NotFoundException(`auction ${auctionId} not found`)
    return toAuctionDto(row)
  }

  async bids(auctionId: string): Promise<BidDto[]> {
    await this.byId(auctionId)
    const rows = await this.db
      .selectFrom('bids')
      .selectAll()
      .where('auction_id', '=', auctionId)
      .orderBy('block_number', 'desc')
      .orderBy('log_index', 'desc')
      .execute()
    return rows.map(toBidDto)
  }
}

export interface AuctionDto {
  auctionId: string
  contractAddress: string
  nftContractAddress: string
  tokenId: string
  seller: string
  reservePrice: string
  currentBid: string | null
  currentBidder: string | null
  winner: string | null
  status: AuctionStatus
  startTime: string
  endTime: string
}

export interface BidDto {
  auctionId: string
  bidder: string
  amount: string
  txHash: string
  blockNumber: number
  blockTime: string
}

function toAuctionDto(row: AuctionRow): AuctionDto {
  return {
    auctionId: row.auction_id,
    contractAddress: row.contract_address,
    nftContractAddress: row.nft_contract_address,
    tokenId: row.token_id,
    seller: row.seller_address,
    reservePrice: row.reserve_price,
    currentBid: row.current_bid,
    currentBidder: row.current_bidder_address,
    winner: row.winner_address,
    status: row.status,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
  }
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
