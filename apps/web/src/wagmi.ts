import { http, createConfig } from 'wagmi'
import { hardhat } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Injected wallets only (MetaMask etc.) — no WalletConnect relay, so the demo
// needs no cloud project id. RainbowKit would slot in here for production.
export const config = createConfig({
  chains: [hardhat],
  connectors: [injected()],
  transports: { [hardhat.id]: http() },
})
