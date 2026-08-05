import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useConnection, useReadContract, useSignMessage, useWriteContract } from 'wagmi'
import { AUCTION_ABI } from '../abi'
import { getToken, getWatchlist, siweLogin } from '../api'
import { AUCTION_ADDRESS } from '../config'
import { StatusBadge } from '../components/StatusBadge'
import { eth } from '../format'

export function MePage() {
  const { address, isConnected } = useConnection()
  const signMessage = useSignMessage()
  const writeContract = useWriteContract()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const loggedIn = getToken() !== null

  const { data: watchlist } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: loggedIn,
  })

  // The pull-payment side of the auction: refunds for outbid offers sit in
  // pendingReturns until their owner withdraws them.
  const { data: pending, refetch: refetchPending } = useReadContract({
    address: AUCTION_ADDRESS,
    abi: AUCTION_ABI,
    functionName: 'pendingReturns',
    args: address === undefined ? undefined : [address],
    query: { enabled: address !== undefined },
  })

  if (!isConnected || address === undefined) {
    return <p className="text-zinc-400">Connect a wallet to see your profile.</p>
  }

  const login = async () => {
    setError(null)
    try {
      await siweLogin(address, (args) => signMessage.mutateAsync(args))
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const withdraw = async () => {
    setError(null)
    try {
      await writeContract.mutateAsync({
        address: AUCTION_ADDRESS,
        abi: AUCTION_ABI,
        functionName: 'withdraw',
      })
      void refetchPending()
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0]! : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="font-mono text-sm text-zinc-400">{address.toLowerCase()}</p>
      </div>

      <section className="rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-400">Pending refunds</h2>
        <div className="mt-2 flex items-center gap-3">
          <span className="font-mono text-lg">{eth(pending?.toString() ?? null)}</span>
          {pending !== undefined && pending > 0n && (
            <button
              onClick={() => void withdraw()}
              className="rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
            >
              Withdraw
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Outbid amounts are escrowed by the contract until you pull them back.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Watchlist</h2>
        {!loggedIn ? (
          <button
            onClick={() => void login()}
            className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          >
            Sign in with Ethereum
          </button>
        ) : watchlist === undefined || watchlist.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing watched yet.</p>
        ) : (
          <ul className="space-y-2">
            {watchlist.map((auction) => (
              <li key={`${auction.contractAddress}-${auction.auctionId}`}>
                <Link
                  to="/auction/$contractAddress/$auctionId"
                  params={{
                    contractAddress: auction.contractAddress,
                    auctionId: auction.auctionId,
                  }}
                  className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2 text-sm hover:border-zinc-600"
                >
                  <span>
                    Auction #{auction.auctionId} · token {auction.tokenId}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono">{eth(auction.currentBid)}</span>
                    <StatusBadge status={auction.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error !== null && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
