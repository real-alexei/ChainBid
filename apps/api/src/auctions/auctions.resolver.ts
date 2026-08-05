import type { AuctionStatus } from '@chainbid/db'
import { Args, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql'
import {
  AuctionConnectionModel,
  AuctionModel,
  AuctionStatusGql,
  BidModel,
} from './auctions.models.js'
import { AuctionsService, type AuctionConnection, type BidDto } from './auctions.service.js'
import type { AuctionSnapshot } from '@chainbid/shared'

const MAX_PAGE_SIZE = 100

@Resolver(() => AuctionModel)
export class AuctionsResolver {
  constructor(private readonly auctions: AuctionsService) {}

  @Query(() => AuctionConnectionModel, { name: 'auctions' })
  auctionsQuery(
    @Args('status', { type: () => AuctionStatusGql, nullable: true }) status?: AuctionStatus,
    @Args('first', { type: () => Int, defaultValue: 20 }) first = 20,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<AuctionConnection> {
    return this.auctions.listConnection(status, Math.min(first, MAX_PAGE_SIZE), after)
  }

  @Query(() => AuctionModel, { name: 'auction' })
  auctionQuery(@Args('auctionId') auctionId: string): Promise<AuctionSnapshot> {
    return this.auctions.byId(auctionId)
  }

  @ResolveField(() => [BidModel])
  bids(@Parent() auction: AuctionModel): Promise<BidDto[]> {
    return this.auctions.bids(auction.auctionId)
  }
}
