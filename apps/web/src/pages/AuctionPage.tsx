import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { useConnection, useReadContract, useSignMessage, useWriteContract } from 'wagmi'
import { AUCTION_ABI } from '../abi'
import { getAuctionWithBids, getToken, siweLogin, unwatchAuction, watchAuction } from '../api'
import { Countdown } from '../components/Countdown'
import { StatusBadge } from '../components/StatusBadge'
import { eth, shortAddress } from '../format'
import { useAuctionFeed } from '../ws'

export function AuctionPage() {
  // The URL carries the auction's full identity; chain calls target the
  // contract from the URL, not a globally configured one.
  const { contractAddress, auctionId } = useParams({
    from: '/auction/$contractAddress/$auctionId',
  })
  const auctionContract = contractAddress as `0x${string}`
  const queryClient = useQueryClient()
  const { address, isConnected } = useConnection()
  const signMessage = useSignMessage()
  const writeContract = useWriteContract()

  const [amount, setAmount] = useState('')
  const [feed, setFeed] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)

  const { data: auction } = useQuery({
    queryKey: ['auction', contractAddress, auctionId],
    queryFn: () => getAuctionWithBids(contractAddress, auctionId),
  })

  // A bid has to clear the standing one by the contract's increment, so read the
  // floor from the chain instead of guessing and letting the wallet eat a revert.
  const { data: floorBid, refetch: refetchFloorBid } = useReadContract({
    address: auctionContract,
    abi: AUCTION_ABI,
    functionName: 'minimumBid',
    args: [BigInt(auctionId)],
  })

  // Chain → indexer → Kafka → projection → pub/sub → here, in about a second.
  useAuctionFeed(contractAddress, auctionId, (event) => {
    setFeed((prev) => [...prev, `${new Date().toLocaleTimeString()} ${event}`])
    void queryClient.invalidateQueries({ queryKey: ['auction', contractAddress, auctionId] })
    void queryClient.invalidateQueries({ queryKey: ['auctions'] })
    void refetchFloorBid()
  })

  if (auction === undefined) return <p className="text-zinc-400">Loading…</p>

  const placeBid = async () => {
    setError(null)
    try {
      await writeContract.mutateAsync({
        address: auctionContract,
        abi: AUCTION_ABI,
        functionName: 'bid',
        args: [BigInt(auctionId)],
        value: parseEther(amount),
      })
      setAmount('')
      void refetchFloorBid()
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0]! : String(err))
    }
  }

  const claimNft = async () => {
    setError(null)
    try {
      await writeContract.mutateAsync({
        address: auctionContract,
        abi: AUCTION_ABI,
        functionName: 'claimNft',
        args: [BigInt(auctionId)],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0]! : String(err))
    }
  }

  const toggleWatch = async () => {
    if (address === undefined) return
    setError(null)
    try {
      if (getToken() === null) {
        await siweLogin(address, (args) => signMessage.mutateAsync(args))
      }
      await (watching
        ? unwatchAuction(contractAddress, auctionId)
        : watchAuction(contractAddress, auctionId))
      setWatching(!watching)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Auction #{auction.auctionId}{' '}
          <span className="text-sm font-normal text-zinc-400">token {auction.tokenId}</span>
        </h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={auction.status} />
          {isConnected && (
            <button
              onClick={() => void toggleWatch()}
              className="rounded border border-zinc-700 px-2 py-1 text-sm text-zinc-300 hover:border-zinc-500"
            >
              {watching ? '★ Watching' : '☆ Watch'}
            </button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-800 p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">Current bid</dt>
          <dd className="font-mono text-lg">{eth(auction.currentBid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Reserve</dt>
          <dd className="font-mono text-lg">{eth(auction.reservePrice)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">
            {auction.status === 'live' ? 'Ends in' : 'Winner'}
          </dt>
          <dd className="text-lg">
            {auction.status === 'live' ? (
              <Countdown endTime={auction.endTime} />
            ) : (
              <span className="font-mono">{shortAddress(auction.winner)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Highest bidder</dt>
          <dd className="font-mono text-lg">{shortAddress(auction.currentBidder)}</dd>
        </div>
      </dl>

      {auction.nftDelivery === 'pending_claim' && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="text-amber-300">
            The NFT could not be delivered on settlement —{' '}
            <span className="font-mono">{shortAddress(auction.nftClaimant)}</span> must claim it
            from the contract.
          </p>
          {address !== undefined && address.toLowerCase() === auction.nftClaimant && (
            <button
              onClick={() => void claimNft()}
              disabled={writeContract.isPending}
              className="shrink-0 rounded bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {writeContract.isPending ? 'Confirm in wallet…' : 'Claim NFT'}
            </button>
          )}
        </div>
      )}

      {auction.status === 'live' && (
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            // The contract requires a 5% raise over the standing bid, so show the
            // floor it will actually accept rather than letting the wallet revert.
            placeholder={floorBid === undefined ? 'ETH' : `min ${formatEther(floorBid)}`}
            className="w-32 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={() => void placeBid()}
            disabled={!isConnected || amount === '' || writeContract.isPending}
            className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {writeContract.isPending ? 'Confirm in wallet…' : 'Place bid'}
          </button>
          {!isConnected && (
            <span className="self-center text-sm text-zinc-500">connect a wallet to bid</span>
          )}
        </div>
      )}
      {error !== null && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          Bid history <span className="text-zinc-600">(from GraphQL)</span>
        </h2>
        {auction.bids.length === 0 ? (
          <p className="text-sm text-zinc-500">No bids yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Bidder</th>
                <th className="py-1 font-normal">Amount</th>
                <th className="py-1 font-normal">Block</th>
                <th className="py-1 font-normal">Time</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-300">
              {auction.bids.map((bid) => (
                <tr key={bid.txHash} className="border-t border-zinc-800/60">
                  <td className="py-1.5">{shortAddress(bid.bidder)}</td>
                  <td className="py-1.5">{eth(bid.amount)}</td>
                  <td className="py-1.5">{bid.blockNumber}</td>
                  <td className="py-1.5">{new Date(bid.blockTime).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          Live feed <span className="text-zinc-600">(WebSocket)</span>
        </h2>
        {feed.length === 0 ? (
          <p className="text-sm text-zinc-500">Waiting for events…</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs text-emerald-400/80">
            {feed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
