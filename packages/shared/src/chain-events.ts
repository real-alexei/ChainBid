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

export const chainEventSchema = z.discriminatedUnion('type', [
  auctionCreatedSchema,
  bidPlacedSchema,
  auctionSettledSchema,
  auctionCancelledSchema,
])

export type AuctionCreatedEvent = z.infer<typeof auctionCreatedSchema>
export type BidPlacedEvent = z.infer<typeof bidPlacedSchema>
export type AuctionSettledEvent = z.infer<typeof auctionSettledSchema>
export type AuctionCancelledEvent = z.infer<typeof auctionCancelledSchema>
export type ChainEvent = z.infer<typeof chainEventSchema>
