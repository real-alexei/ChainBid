import assert from 'node:assert/strict'
import { Contract, Interface, JsonRpcProvider, parseEther, Wallet } from 'ethers'
import { SiweMessage } from 'siwe'

// Full-loop end-to-end check against a running stack: mint → auction → 3 bids
// → auto-settlement, asserted through REST, GraphQL, and a captured WS stream.
// Requires: docker compose infra, hardhat node with contracts deployed, and
// the api/indexer/worker processes (see .github/workflows/ci.yml).

const API = process.env['API_URL'] ?? 'http://localhost:3000'
const RPC = process.env['RPC_URL'] ?? 'http://localhost:8545'
const NFT_ADDRESS = process.env['NFT_ADDRESS'] ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const AUCTION_ADDRESS =
  process.env['AUCTION_ADDRESS'] ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

const provider = new JsonRpcProvider(RPC)
const auctionIface = new Interface([
  'event AuctionCreated(uint256 indexed auctionId, address indexed seller, address indexed nft, uint256 tokenId, uint256 reservePrice, uint64 startTime, uint64 endTime)',
])

async function waitFor<T>(label: string, timeoutMs: number, poll: () => Promise<T | null>) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await poll()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function json<T>(res: Response): Promise<T> {
  assert.ok(res.ok, `${res.url} -> ${res.status}`)
  return (await res.json()) as T
}

async function graphql<T>(query: string): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = (await res.json()) as { data?: T; errors?: unknown[] }
  assert.equal(body.errors, undefined, `graphql errors: ${JSON.stringify(body.errors)}`)
  assert.ok(body.data !== undefined)
  return body.data
}

// --- 0. stack sanity -------------------------------------------------------
const health = await json<{ status: string }>(await fetch(`${API}/health`))
assert.equal(health.status, 'ok')
console.log('health: ok')

// --- 1. mint + create auction ---------------------------------------------
const seller = await provider.getSigner(0)
const sellerAddress = (await seller.getAddress()).toLowerCase()
const nft = new Contract(
  NFT_ADDRESS,
  [
    'function safeMint(address to, string uri) returns (uint256)',
    'function approve(address to, uint256 tokenId)',
    'function nextTokenId() view returns (uint256)',
  ],
  seller,
)
const tokenId = (await nft['nextTokenId']!()) as bigint
await (await nft['safeMint']!(sellerAddress, `ipfs://e2e/${tokenId}`)).wait()
await (await nft['approve']!(AUCTION_ADDRESS, tokenId)).wait()

const auction = new Contract(
  AUCTION_ADDRESS,
  [
    'function createAuction(address nft, uint256 tokenId, uint256 reservePrice, uint64 duration) returns (uint256)',
    'function bid(uint256 auctionId) payable',
  ],
  seller,
)
const receipt = await (
  await auction['createAuction']!(NFT_ADDRESS, tokenId, parseEther('1'), 3600)
).wait()
const created = receipt.logs
  .map((log: { topics: readonly string[]; data: string }) => auctionIface.parseLog(log))
  .find((parsed: { name: string } | null) => parsed?.name === 'AuctionCreated')
assert.ok(created, 'AuctionCreated log missing')
const auctionId = String(created.args['auctionId'])
// The read model keys auctions by (contract, id); addresses are stored lowercase.
const auctionContract = AUCTION_ADDRESS.toLowerCase()
console.log(`auction ${auctionContract}/${auctionId} created for token ${tokenId}`)

// --- 2. capture the WS stream for this auction -----------------------------
const frames: { event: string; data: { currentBid: string | null; status: string } }[] = []
const ws = new WebSocket(`${API.replace('http', 'ws')}/ws`)
ws.onmessage = (msg) => frames.push(JSON.parse(String(msg.data)))
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => {
    ws.send(
      JSON.stringify({ event: 'subscribe', data: { contractAddress: auctionContract, auctionId } }),
    )
    resolve()
  }
  ws.onerror = () => reject(new Error('ws connect failed'))
})

// --- 3. three bids from three wallets --------------------------------------
const amounts = ['1', '1.2', '1.5'] as const
for (const [i, amount] of amounts.entries()) {
  const bidder = await provider.getSigner(i + 1)
  const bound = auction.connect(bidder) as Contract
  await (await bound['bid']!(BigInt(auctionId), { value: parseEther(amount) })).wait()
}
const highBid = parseEther('1.5').toString()
const highBidder = (await (await provider.getSigner(3)).getAddress()).toLowerCase()

// --- 4. REST read model catches up -----------------------------------------
for (let i = 0; i < 6; i++) await provider.send('evm_mine', [])
const auctionRest = await waitFor('REST projection', 30_000, async () => {
  const res = await fetch(`${API}/auctions/${auctionContract}/${auctionId}`)
  if (!res.ok) return null
  const body = (await res.json()) as { currentBid: string | null; currentBidder: string | null }
  return body.currentBid === highBid ? body : null
})
assert.equal(auctionRest.currentBidder, highBidder)
const bids = await json<{ amount: string }[]>(
  await fetch(`${API}/auctions/${auctionContract}/${auctionId}/bids`),
)
assert.equal(bids.length, 3)
assert.equal(bids[0]?.amount, highBid)
console.log('REST: current bid and 3-bid history match')

// --- 5. GraphQL agrees with REST -------------------------------------------
const gql = await graphql<{
  auction: { currentBid: string; status: string; bids: { amount: string; bidder: string }[] }
}>(
  `{ auction(contractAddress: "${auctionContract}", auctionId: "${auctionId}") { currentBid status bids { amount bidder } } }`,
)
assert.equal(gql.auction.currentBid, highBid)
assert.equal(gql.auction.status, 'LIVE')
assert.equal(gql.auction.bids.length, 3)
assert.equal(gql.auction.bids[0]?.bidder, highBidder)
console.log('GraphQL: matches REST')

// --- 6. SIWE login + watchlist ---------------------------------------------
const wallet = Wallet.createRandom()
const { nonce } = await json<{ nonce: string }>(await fetch(`${API}/auth/nonce`))
const message = new SiweMessage({
  domain: 'localhost:5173',
  address: wallet.address,
  uri: 'http://localhost:5173',
  version: '1',
  chainId: 31337,
  nonce,
}).prepareMessage()
const { token } = await json<{ token: string }>(
  await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature: await wallet.signMessage(message) }),
  }),
)
const auth = { authorization: `Bearer ${token}` }
await json(
  await fetch(`${API}/auctions/${auctionContract}/${auctionId}/watch`, {
    method: 'POST',
    headers: auth,
  }),
)
const watchlist = await json<{ auctionId: string }[]>(
  await fetch(`${API}/watchlist`, { headers: auth }),
)
assert.equal(watchlist[0]?.auctionId, auctionId)
console.log('SIWE + watchlist: ok')

// --- 7. warp past the end; the settlement watcher takes it from here --------
await provider.send('evm_increaseTime', [3700])
await waitFor('auto-settlement', 90_000, async () => {
  await provider.send('evm_mine', [])
  const res = await fetch(`${API}/auctions/${auctionContract}/${auctionId}`)
  if (!res.ok) return null
  const body = (await res.json()) as { status: string; winner: string | null }
  return body.status === 'settled' ? body : null
}).then((settled) => assert.equal(settled.winner, highBidder))
console.log('settlement watcher: auction settled, winner correct')

// --- 8. the WS stream saw the whole story -----------------------------------
const events = frames.map((frame) => frame.event)
assert.ok(events.includes('auction.created'), `no auction.created in ${events.join(',')}`)
assert.equal(events.filter((event) => event === 'bid.placed').length >= 3, true)
assert.equal(events.at(-1), 'auction.settled')
assert.equal(frames.at(-1)?.data.currentBid, highBid)
ws.close()
console.log(`WS: captured ${frames.length} frames ending in auction.settled`)

console.log('\nE2E PASS')
process.exit(0)
