export const TOPICS = {
  /** Confirmed on-chain events, produced by the indexer. Key = auction id. */
  chainEvents: 'chain.events',
  /** Emitted by the projection consumer after the read model commit. */
  auctionProjected: 'auction.projected',
} as const

export const REDIS_CHANNELS = {
  /** Worker → api fan-out of projected auction updates for the WS feed. */
  auctionUpdates: 'auction.updates',
} as const
