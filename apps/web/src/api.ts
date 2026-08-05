import type { AuctionSnapshot, AuctionUpdate } from '@chainbid/shared'
import { getAddress } from 'viem'
import { API_URL, CHAIN_ID, SIWE_DOMAIN } from './config'

export type { AuctionSnapshot, AuctionUpdate }

export interface Bid {
  auctionId: string
  bidder: string
  amount: string
  txHash: string
  blockNumber: number
  blockTime: string
}

const TOKEN_KEY = 'chainbid.jwt'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (res.status === 401) localStorage.removeItem(TOKEN_KEY)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return (await res.json()) as T
}

export const listAuctions = () => request<AuctionSnapshot[]>('/auctions')
export const getWatchlist = () => request<AuctionSnapshot[]>('/watchlist')
export const watchAuction = (contractAddress: string, id: string) =>
  request(`/auctions/${contractAddress}/${id}/watch`, { method: 'POST' })
export const unwatchAuction = (contractAddress: string, id: string) =>
  request(`/auctions/${contractAddress}/${id}/watch`, { method: 'DELETE' })

export async function graphql<T>(query: string): Promise<T> {
  const body = await request<{ data?: T; errors?: { message: string }[] }>('/graphql', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
  if (body.errors !== undefined) throw new Error(body.errors[0]?.message ?? 'graphql error')
  if (body.data === undefined) throw new Error('graphql returned no data')
  return body.data
}

export const getAuctionWithBids = (contractAddress: string, id: string) =>
  graphql<{ auction: AuctionSnapshot & { bids: Bid[] } }>(
    `{ auction(contractAddress: "${contractAddress}", auctionId: "${id}") {
        auctionId contractAddress nftContractAddress tokenId seller
        reservePrice currentBid currentBidder winner status startTime endTime
        bids { auctionId bidder amount txHash blockNumber blockTime } }}`,
  ).then((data) => data.auction)

/**
 * EIP-4361 message built by hand — the format is a short spec and doing it
 * here keeps the siwe package (and its ethers peer) out of the bundle.
 * The server parses and verifies it with the real siwe library.
 */
export async function siweLogin(
  address: string,
  signMessage: (args: { message: string }) => Promise<string>,
): Promise<void> {
  const { nonce } = await request<{ nonce: string }>('/auth/nonce')
  const message = [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    getAddress(address),
    '',
    'Sign in to ChainBid',
    '',
    `URI: http://${SIWE_DOMAIN}`,
    'Version: 1',
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n')
  const signature = await signMessage({ message })
  const { token } = await request<{ token: string }>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  })
  localStorage.setItem(TOKEN_KEY, token)
}
