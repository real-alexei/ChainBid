import type { AuctionSnapshot } from '@chainbid/shared'
import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { AuctionsService } from '../auctions/auctions.service.js'
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js'
import { WatchlistService } from './watchlist.service.js'

@Controller()
@UseGuards(AuthGuard)
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly auctions: AuctionsService,
  ) {}

  @Post('auctions/:id/watch')
  async watch(@Param('id') id: string, @Req() request: AuthedRequest): Promise<{ ok: true }> {
    const auction = await this.auctions.byId(id)
    await this.watchlist.watch(wallet(request), auction.contractAddress, auction.auctionId)
    return { ok: true }
  }

  @Delete('auctions/:id/watch')
  async unwatch(@Param('id') id: string, @Req() request: AuthedRequest): Promise<{ ok: true }> {
    const auction = await this.auctions.byId(id)
    await this.watchlist.unwatch(wallet(request), auction.contractAddress, auction.auctionId)
    return { ok: true }
  }

  @Get('watchlist')
  list(@Req() request: AuthedRequest): Promise<AuctionSnapshot[]> {
    return this.watchlist.list(wallet(request))
  }
}

function wallet(request: AuthedRequest): string {
  if (request.address === undefined) throw new Error('guard did not set address')
  return request.address
}
