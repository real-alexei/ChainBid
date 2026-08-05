import type { AuctionStatus } from '@chainbid/db'
import type { AuctionSnapshot } from '@chainbid/shared'
import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common'
import { AuctionsService, type BidDto } from './auctions.service.js'

const AUCTION_STATUSES = ['created', 'live', 'settled', 'cancelled'] as const

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get()
  list(@Query('status') status?: string): Promise<AuctionSnapshot[]> {
    if (status === undefined) return this.auctions.list()
    if (!isAuctionStatus(status)) {
      throw new BadRequestException(`status must be one of: ${AUCTION_STATUSES.join(', ')}`)
    }
    return this.auctions.list(status)
  }

  @Get(':contract/:id')
  byId(@Param('contract') contract: string, @Param('id') id: string): Promise<AuctionSnapshot> {
    return this.auctions.byId(parseContractAddress(contract), parseAuctionId(id))
  }

  @Get(':contract/:id/bids')
  bids(@Param('contract') contract: string, @Param('id') id: string): Promise<BidDto[]> {
    return this.auctions.bids(parseContractAddress(contract), parseAuctionId(id))
  }
}

export function parseAuctionId(id: string): string {
  if (!/^\d+$/.test(id)) throw new BadRequestException('auction id must be a decimal number')
  return id
}

export function parseContractAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new BadRequestException('contract address must be a 0x-prefixed hex address')
  }
  return address.toLowerCase()
}

function isAuctionStatus(value: string): value is AuctionStatus {
  return (AUCTION_STATUSES as readonly string[]).includes(value)
}
