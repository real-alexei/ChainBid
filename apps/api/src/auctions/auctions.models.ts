import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql'

// GraphQL shapes for the auction read model. Wei amounts are strings — they
// exceed both GraphQL Int and JS number range.

export const AuctionStatusGql = {
  CREATED: 'created',
  LIVE: 'live',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
} as const

registerEnumType(AuctionStatusGql, { name: 'AuctionStatus' })

@ObjectType('Auction')
export class AuctionModel {
  @Field()
  auctionId!: string

  @Field()
  contractAddress!: string

  @Field()
  nftContractAddress!: string

  @Field()
  tokenId!: string

  @Field()
  seller!: string

  @Field()
  reservePrice!: string

  @Field(() => String, { nullable: true })
  currentBid!: string | null

  @Field(() => String, { nullable: true })
  currentBidder!: string | null

  @Field(() => String, { nullable: true })
  winner!: string | null

  @Field(() => AuctionStatusGql)
  status!: string

  @Field()
  startTime!: string

  @Field()
  endTime!: string
}

@ObjectType('Bid')
export class BidModel {
  @Field()
  auctionId!: string

  @Field()
  bidder!: string

  @Field()
  amount!: string

  @Field()
  txHash!: string

  @Field(() => Int)
  blockNumber!: number

  @Field()
  blockTime!: string
}

@ObjectType('AuctionConnection')
export class AuctionConnectionModel {
  @Field(() => [AuctionModel])
  nodes!: AuctionModel[]

  @Field(() => String, { nullable: true })
  endCursor!: string | null

  @Field()
  hasNextPage!: boolean
}
