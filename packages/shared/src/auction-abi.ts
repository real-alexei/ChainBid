// Human-readable fragments for the EnglishAuction events the indexer parses.
// Kept in sync with contracts/contracts/EnglishAuction.sol by hand — the
// indexer only needs events, not the full generated ABI.
export const ENGLISH_AUCTION_EVENTS = [
  'event AuctionCreated(uint256 indexed auctionId, address indexed seller, address indexed nft, uint256 tokenId, uint256 reservePrice, uint64 startTime, uint64 endTime)',
  'event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount, address previousBidder, uint256 previousBid, uint64 endTime)',
  'event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 amount, address indexed seller)',
  'event AuctionCancelled(uint256 indexed auctionId, address indexed seller)',
  'event NftDeliveryFailed(uint256 indexed auctionId, address indexed claimant)',
  'event NftClaimed(uint256 indexed auctionId, address indexed claimant)',
] as const
