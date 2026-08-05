import type { AuctionSnapshot } from './projections.js'

// Redis cache keys are built here so the api (reader) and the worker
// (invalidator) can never drift apart.

type AuctionStatusName = AuctionSnapshot['status']

export const CACHE_KEYS = {
  auction: (auctionId: string): string => `auction:${auctionId}`,
  auctionList: (status?: AuctionStatusName): string => `auctions:${status ?? 'all'}`,
} as const

const STATUSES: readonly AuctionStatusName[] = ['created', 'live', 'settled', 'cancelled']

/** Every list cache key, for invalidation. */
export const ALL_AUCTION_LIST_KEYS: readonly string[] = [
  CACHE_KEYS.auctionList(),
  ...STATUSES.map((status) => CACHE_KEYS.auctionList(status)),
]
