import { z } from 'zod'

// Payloads for the chain.events topic, validated at both produce and consume
// time. Addresses are lowercased by the indexer; uint256 values travel as
// decimal strings because they exceed Number range; unix timestamps fit in
// Number and stay numeric.

const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const hash = z.string().regex(/^0x[0-9a-f]{64}$/)
const uint256 = z.string().regex(/^\d+$/)

const envelope = {
  contractAddress: address,
  auctionId: uint256,
  blockNumber: z.number().int().nonnegative(),
  blockHash: hash,
  blockTime: z.number().int().nonnegative(),
  txHash: hash,
  logIndex: z.number().int().nonnegative(),
}

export const auctionCreatedSchema = z.object({
  ...envelope,
  type: z.literal('AuctionCreated'),
  seller: address,
  nft: address,
  tokenId: uint256,
  reservePrice: uint256,
  startTime: z.number().int().nonnegative(),
  endTime: z.number().int().nonnegative(),
})

export const bidPlacedSchema = z.object({
  ...envelope,
  type: z.literal('BidPlaced'),
  bidder: address,
  amount: uint256,
  previousBidder: address,
  previousBid: uint256,
  endTime: z.number().int().nonnegative(),
})

export const auctionSettledSchema = z.object({
  ...envelope,
  type: z.literal('AuctionSettled'),
  seller: address,
  winner: address,
  amount: uint256,
})

export const auctionCancelledSchema = z.object({
  ...envelope,
  type: z.literal('AuctionCancelled'),
  seller: address,
})

// Settlement pushed the token but the transfer reverted; `claimant` must pull
// it with claimNft(). Fires inside the same tx as Settled/Cancelled.
export const nftDeliveryFailedSchema = z.object({
  ...envelope,
  type: z.literal('NftDeliveryFailed'),
  claimant: address,
})

export const nftClaimedSchema = z.object({
  ...envelope,
  type: z.literal('NftClaimed'),
  claimant: address,
})

export const chainEventSchema = z.discriminatedUnion('type', [
  auctionCreatedSchema,
  bidPlacedSchema,
  auctionSettledSchema,
  auctionCancelledSchema,
  nftDeliveryFailedSchema,
  nftClaimedSchema,
])

// Not an on-chain event: the indexer publishes this before replaying a range
// after a reorg. fromBlock is the last block still trusted — consumers must
// discard everything they projected above it, because an orphaned event may
// have no canonical replacement and replay alone cannot remove it.
export const chainReorgSchema = z.object({
  type: z.literal('ChainReorg'),
  contractAddress: address,
  fromBlock: z.number().int().nonnegative(),
})

/** Everything that travels on chain.events: auction events plus the reorg marker. */
export const chainMessageSchema = z.discriminatedUnion('type', [
  auctionCreatedSchema,
  bidPlacedSchema,
  auctionSettledSchema,
  auctionCancelledSchema,
  nftDeliveryFailedSchema,
  nftClaimedSchema,
  chainReorgSchema,
])

export type AuctionCreatedEvent = z.infer<typeof auctionCreatedSchema>
export type BidPlacedEvent = z.infer<typeof bidPlacedSchema>
export type AuctionSettledEvent = z.infer<typeof auctionSettledSchema>
export type AuctionCancelledEvent = z.infer<typeof auctionCancelledSchema>
export type NftDeliveryFailedEvent = z.infer<typeof nftDeliveryFailedSchema>
export type NftClaimedEvent = z.infer<typeof nftClaimedSchema>
export type ChainEvent = z.infer<typeof chainEventSchema>
export type ChainReorgEvent = z.infer<typeof chainReorgSchema>
export type ChainMessage = z.infer<typeof chainMessageSchema>
