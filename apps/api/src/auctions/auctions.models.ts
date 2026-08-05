import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql'

// GraphQL shapes for the auction read model. Wei amounts are strings — they
// exceed both GraphQL Int and JS number range.

// Enum value names are deliberately lowercase: GraphQL serializes an enum to
// its value's NAME, and REST and the WS feed both send the snapshot's
// lowercase strings — uppercase names here would make the same auction read
// "LIVE" over GraphQL and "live" everywhere else.
export const AuctionStatusGql = {
  created: 'created',
  live: 'live',
  settled: 'settled',
  cancelled: 'cancelled',
} as const

registerEnumType(AuctionStatusGql, { name: 'AuctionStatus' })

export const NftDeliveryGql = {
  pending_claim: 'pending_claim',
  claimed: 'claimed',
} as const

registerEnumType(NftDeliveryGql, { name: 'NftDelivery' })

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

  @Field(() => NftDeliveryGql, { nullable: true })
  nftDelivery!: string | null

  @Field(() => String, { nullable: true })
  nftClaimant!: string | null

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
