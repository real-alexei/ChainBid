import { useConnection, useSwitchChain } from 'wagmi'
import { CHAIN_ID } from '../config'

/**
 * Writes already refuse to fire on the wrong chain (every writeContract call
 * pins chainId), but that error only surfaces after a click — this tells the
 * user up front and offers the one-click fix.
 */
export function NetworkBanner() {
  const { isConnected, chainId } = useConnection()
  const switchChain = useSwitchChain()

  if (!isConnected || chainId === CHAIN_ID) return null

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2 text-sm text-amber-300">
        <span>Wallet is on the wrong network — this app runs on chain {CHAIN_ID}.</span>
        <button
          onClick={() => switchChain.mutate({ chainId: CHAIN_ID })}
          disabled={switchChain.isPending}
          className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        >
          {switchChain.isPending ? 'Confirm in wallet…' : 'Switch network'}
        </button>
      </div>
    </div>
  )
}
