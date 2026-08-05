import type { Selectable } from 'kysely'
import type { Auctions, Bids } from './schema.js'

// Row shapes as they come back from a select, for consumers that do not
// depend on kysely directly.
export type AuctionRow = Selectable<Auctions>
export type BidRow = Selectable<Bids>
