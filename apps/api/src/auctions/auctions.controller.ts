import type { AuctionStatus } from '@chainbid/db'
import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common'
import { AuctionsService, type AuctionDto, type BidDto } from './auctions.service.js'

const AUCTION_STATUSES = ['created', 'live', 'settled', 'cancelled'] as const

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  list(@Query('status') status?: string): Promise<AuctionDto[]> {
    if (status === undefined) return this.auctions.list()
    if (!isAuctionStatus(status)) {
      throw new BadRequestException(`status must be one of: ${AUCTION_STATUSES.join(', ')}`)
    }
    return this.auctions.list(status)
  }

  @Get(':id')
  byId(@Param('id') id: string): Promise<AuctionDto> {
    return this.auctions.byId(parseAuctionId(id))
  }

  @Get(':id/bids')
  bids(@Param('id') id: string): Promise<BidDto[]> {
    return this.auctions.bids(parseAuctionId(id))
  }
}

function parseAuctionId(id: string): string {
  if (!/^\d+$/.test(id)) throw new BadRequestException('auction id must be a decimal number')
  return id
}

function isAuctionStatus(value: string): value is AuctionStatus {
  return (AUCTION_STATUSES as readonly string[]).includes(value)
}
