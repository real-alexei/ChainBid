import { z } from 'zod'

// Payloads that live downstream of the read model: auction.projected on Kafka
// and auction.updates on Redis pub/sub.

const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const uint256 = z.string().regex(/^\d+$/)

export const auctionProjectedSchema = z.object({
  type: z.enum([
    'AuctionCreated',
    'BidPlaced',
    'AuctionSettled',
    'AuctionCancelled',
    'NftDeliveryFailed',
    'NftClaimed',
  ]),
  contractAddress: address,
  auctionId: uint256,
  blockNumber: z.number().int().nonnegative(),
})

export type AuctionProjected = z.infer<typeof auctionProjectedSchema>

/** One auction as served to clients (REST, GraphQL, and the WS feed). */
export const auctionSnapshotSchema = z.object({
  auctionId: uint256,
  contractAddress: address,
  nftContractAddress: address,
  tokenId: uint256,
  seller: address,
  reservePrice: uint256,
  currentBid: uint256.nullable(),
  currentBidder: address.nullable(),
  winner: address.nullable(),
  status: z.enum(['created', 'live', 'settled', 'cancelled']),
  // Null until settlement fails to push the token; then the recipient shows up
  // here and must pull it with claimNft().
  nftDelivery: z.enum(['pending_claim', 'claimed']).nullable(),
  nftClaimant: address.nullable(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
})

export type AuctionSnapshot = z.infer<typeof auctionSnapshotSchema>

export const auctionUpdateSchema = z.object({
  // The nft.* pair keeps the auction. prefix — the web feed filters on it.
  event: z.enum([
    'auction.created',
    'bid.placed',
    'auction.settled',
    'auction.cancelled',
    'auction.nft_delivery_failed',
    'auction.nft_claimed',
  ]),
  auction: auctionSnapshotSchema,
})

export type AuctionUpdate = z.infer<typeof auctionUpdateSchema>

export const AUCTION_UPDATE_EVENTS = {
  AuctionCreated: 'auction.created',
  BidPlaced: 'bid.placed',
  AuctionSettled: 'auction.settled',
  AuctionCancelled: 'auction.cancelled',
  NftDeliveryFailed: 'auction.nft_delivery_failed',
  NftClaimed: 'auction.nft_claimed',
} as const satisfies Record<AuctionProjected['type'], AuctionUpdate['event']>

/**
 * Maps an auctions row to the client-facing shape. The input is structural on
 * purpose: it matches the db package's AuctionRow without depending on it.
 */
export function toAuctionSnapshot(row: {
  auction_id: string
  contract_address: string
  nft_contract_address: string
  token_id: string
  seller_address: string
  reserve_price: string
  current_bid: string | null
  current_bidder_address: string | null
  winner_address: string | null
  status: AuctionSnapshot['status']
  nft_delivery: AuctionSnapshot['nftDelivery']
  nft_claimant_address: string | null
  start_time: Date
  end_time: Date
}): AuctionSnapshot {
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
    nftDelivery: row.nft_delivery,
    nftClaimant: row.nft_claimant_address,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
  }
}
