import { ENGLISH_AUCTION_EVENTS } from '@chainbid/shared'
import { parseAbi } from 'viem'

export const NFT_ABI = parseAbi([
  'function safeMint(address to, string uri) returns (uint256)',
  'function approve(address to, uint256 tokenId)',
  // The id of a fresh mint is read back from this log. nextTokenId() looks like
  // the shortcut, but minting is permissionless: anything minted between the
  // read and our own transaction shifts the id we would have assumed.
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export const AUCTION_ABI = parseAbi([
  'function createAuction(address nft, uint256 tokenId, uint256 reservePrice, uint64 duration) returns (uint256)',
  'function bid(uint256 auctionId) payable',
  // The contract enforces a minimum increment over the standing bid; ask it for the
  // floor rather than reimplementing the rule here and drifting out of sync.
  'function minimumBid(uint256 auctionId) view returns (uint256)',
  'function pendingReturns(address bidder) view returns (uint256)',
  'function withdraw()',
  'function claimNft(uint256 auctionId)',
  ...ENGLISH_AUCTION_EVENTS,
])
