import { anyValue } from '@nomicfoundation/hardhat-ethers-chai-matchers/withArgs'
import { expect } from 'chai'
import { network } from 'hardhat'

const { ethers, networkHelpers } = await network.create()

const RESERVE = ethers.parseEther('1')
const DURATION = 3600n
const TOKEN_URI = 'ipfs://chainbid/1'

/**
 * The path a real auction takes, driven from off-chain exactly as the indexer
 * and the e2e script will drive it. Contract rules are covered by the Solidity
 * tests; what is asserted here is the *event stream*, since that is the only
 * thing downstream services ever see.
 */
async function deployFixture() {
  const [, seller, alice, bob] = await ethers.getSigners()
  if (seller === undefined || alice === undefined || bob === undefined) {
    throw new Error('expected the dev chain to provide at least four funded signers')
  }

  const nft = await ethers.deployContract('ChainBidNFT')
  const house = await ethers.deployContract('EnglishAuction')

  const tokenId = await nft.nextTokenId()
  await nft.connect(seller).safeMint(seller.address, TOKEN_URI)
  await nft.connect(seller).approve(await house.getAddress(), tokenId)

  return { seller, alice, bob, nft, house, tokenId }
}

describe('auction lifecycle', function () {
  it('carries every fact a read model needs on the events alone', async function () {
    const { seller, alice, bob, nft, house, tokenId } =
      await networkHelpers.loadFixture(deployFixture)

    const nftAddress = await nft.getAddress()
    const houseAddress = await house.getAddress()

    // --- create ---
    await expect(house.connect(seller).createAuction(nftAddress, tokenId, RESERVE, DURATION))
      .to.emit(house, 'AuctionCreated')
      .withArgs(1n, seller.address, nftAddress, tokenId, RESERVE, anyValue, anyValue)

    expect(await nft.ownerOf(tokenId)).to.equal(houseAddress)

    // --- bids ---
    const first = ethers.parseEther('1.5')
    const second = ethers.parseEther('2')

    await expect(house.connect(alice).bid(1n, { value: first }))
      .to.emit(house, 'BidPlaced')
      .withArgs(1n, alice.address, first, ethers.ZeroAddress, 0n, anyValue)

    // The outbid event names who was displaced and for how much, so a projection
    // can update both bidders from a single log.
    await expect(house.connect(bob).bid(1n, { value: second }))
      .to.emit(house, 'BidPlaced')
      .withArgs(1n, bob.address, second, alice.address, first, anyValue)

    expect(await house.pendingReturns(alice.address)).to.equal(first)

    // --- settle ---
    const auction = await house.getAuction(1n)
    await networkHelpers.time.increaseTo(auction.endTime)

    await expect(house.settle(1n))
      .to.emit(house, 'AuctionSettled')
      .withArgs(1n, bob.address, second, seller.address)

    expect(await nft.ownerOf(tokenId)).to.equal(bob.address)
    expect(await house.pendingReturns(seller.address)).to.equal(second)

    // --- withdrawals ---
    await house.connect(alice).withdraw()
    expect(await house.pendingReturns(alice.address)).to.equal(0n)

    await house.connect(seller).withdraw()
    expect(await house.pendingReturns(seller.address)).to.equal(0n)

    // Everything owed has been paid out.
    expect(await ethers.provider.getBalance(houseAddress)).to.equal(0n)
  })

  it('extends the close when a bid lands inside the extension window', async function () {
    const { seller, alice, nft, house, tokenId } = await networkHelpers.loadFixture(deployFixture)

    await house.connect(seller).createAuction(await nft.getAddress(), tokenId, RESERVE, DURATION)
    const before = (await house.getAuction(1n)).endTime

    await networkHelpers.time.increaseTo(before - 60n)
    await house.connect(alice).bid(1n, { value: RESERVE })

    expect((await house.getAuction(1n)).endTime).to.be.greaterThan(before)
  })
})
