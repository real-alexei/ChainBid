import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

/**
 * Deploys the pair. Ignition records the resulting addresses under
 * `ignition/deployments/chain-<id>/deployed_addresses.json`, which is what the
 * indexer reads rather than having addresses pasted into env vars by hand.
 */
export default buildModule('ChainBid', (m) => {
  const nft = m.contract('ChainBidNFT')
  const auctionHouse = m.contract('EnglishAuction')

  return { nft, auctionHouse }
})
