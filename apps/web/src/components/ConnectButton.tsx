import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { shortAddress } from '../format'

export function ConnectButton() {
  const { address, isConnected } = useConnection()
  const connect = useConnect()
  const connectors = useConnectors()
  const disconnect = useDisconnect()

  if (isConnected && address !== undefined) {
    return (
      <button
        onClick={() => disconnect.mutate({})}
        className="rounded border border-zinc-700 px-3 py-1 font-mono text-sm text-zinc-300 hover:border-zinc-500"
        title="Disconnect"
      >
        {shortAddress(address)}
      </button>
    )
  }
  return (
    <button
      onClick={() => connect.mutate({ connector: connectors[0]! })}
      className="rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
    >
      Connect wallet
    </button>
  )
}
