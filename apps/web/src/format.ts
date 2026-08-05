import { formatEther } from 'viem'

export const eth = (wei: string | null): string =>
  wei === null ? '—' : `${formatEther(BigInt(wei))} ETH`

export const shortAddress = (address: string | null): string =>
  address === null ? '—' : `${address.slice(0, 6)}…${address.slice(-4)}`

export function countdown(endTime: string, now: number): string {
  const left = Math.floor((new Date(endTime).getTime() - now) / 1000)
  if (left <= 0) return 'ended'
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}
