import { useEffect } from 'react'
import type { AuctionUpdate } from '@chainbid/shared'
import { WS_URL } from './config'

/** Native-WebSocket live feed for one auction; reconnects are the reader's F5. */
export function useAuctionFeed(
  auctionId: string,
  onUpdate: (event: string, auction: AuctionUpdate['auction']) => void,
): void {
  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    ws.onopen = () => ws.send(JSON.stringify({ event: 'subscribe', data: { auctionId } }))
    ws.onmessage = (msg) => {
      const frame = JSON.parse(String(msg.data)) as { event: string; data: unknown }
      if (frame.event.startsWith('auction.') || frame.event === 'bid.placed') {
        onUpdate(frame.event, frame.data as AuctionUpdate['auction'])
      }
    }
    return () => ws.close()
    // onUpdate identity is deliberately not a resubscribe reason
  }, [auctionId])
}
