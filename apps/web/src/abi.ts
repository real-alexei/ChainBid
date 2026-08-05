import { ENGLISH_AUCTION_EVENTS } from '@chainbid/shared'
import { parseAbi } from 'viem'

export const NFT_ABI = parseAbi([
  'function safeMint(address to, string uri) returns (uint256)',
  'function approve(address to, uint256 tokenId)',
  'function nextTokenId() view returns (uint256)',
])

export const AUCTION_ABI = parseAbi([
  'function createAuction(address nft, uint256 tokenId, uint256 reservePrice, uint64 duration) returns (uint256)',
  'function bid(uint256 auctionId) payable',
  'function pendingReturns(address bidder) view returns (uint256)',
  'function withdraw()',
  ...ENGLISH_AUCTION_EVENTS,
])
