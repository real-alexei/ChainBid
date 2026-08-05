import { z } from 'zod'

// Payloads for the outbox.events topic. The relay moves them verbatim — the
// schema is enforced where the payload is written (api) and consumed (worker).

const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const uint256 = z.string().regex(/^\d+$/)

export const watchlistEventSchema = z.object({
  type: z.enum(['watchlist.added', 'watchlist.removed']),
  wallet: address,
  contractAddress: address,
  auctionId: uint256,
})

export type WatchlistEvent = z.infer<typeof watchlistEventSchema>

export const outboxEventSchema = z.discriminatedUnion('type', [watchlistEventSchema])

export type OutboxEvent = z.infer<typeof outboxEventSchema>
