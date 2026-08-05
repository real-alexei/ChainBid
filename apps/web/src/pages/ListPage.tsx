import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listAuctions } from '../api'
import { Countdown } from '../components/Countdown'
import { StatusBadge } from '../components/StatusBadge'
import { eth, shortAddress } from '../format'

export function ListPage() {
  const { data: auctions, isLoading } = useQuery({
    queryKey: ['auctions'],
    queryFn: listAuctions,
    refetchInterval: 10_000,
  })

  if (isLoading) return <p className="text-zinc-400">Loading…</p>
  if (auctions === undefined || auctions.length === 0) {
    return (
      <p className="text-zinc-400">
        No auctions yet —{' '}
        <Link to="/sell" className="text-emerald-400 hover:underline">
          create the first one
        </Link>
        .
      </p>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {auctions.map((auction) => (
        <Link
          key={`${auction.contractAddress}-${auction.auctionId}`}
          to="/auction/$auctionId"
          params={{ auctionId: auction.auctionId }}
          className="rounded-lg border border-zinc-800 p-4 transition hover:border-zinc-600"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">
              Auction #{auction.auctionId} · token {auction.tokenId}
            </span>
            <StatusBadge status={auction.status} />
          </div>
          <dl className="mt-3 space-y-1 text-sm text-zinc-400">
            <div className="flex justify-between">
              <dt>Current bid</dt>
              <dd className="font-mono text-zinc-200">{eth(auction.currentBid)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Reserve</dt>
              <dd className="font-mono">{eth(auction.reservePrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Seller</dt>
              <dd className="font-mono">{shortAddress(auction.seller)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Ends</dt>
              <dd>{auction.status === 'live' ? <Countdown endTime={auction.endTime} /> : '—'}</dd>
            </div>
          </dl>
        </Link>
      ))}
    </div>
  )
}
