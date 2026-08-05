import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { parseEther, parseEventLogs } from 'viem'
import { useConnection, usePublicClient, useWriteContract } from 'wagmi'
import { AUCTION_ABI, NFT_ABI } from '../abi'
import { AUCTION_ADDRESS, CHAIN_ID, NFT_ADDRESS } from '../config'

/// Mirrors `EnglishAuction.MIN_DURATION`, which is pinned to the extension window.
const MIN_DURATION_MINUTES = 5

export function SellPage() {
  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const writeContract = useWriteContract()
  const navigate = useNavigate()

  const [uri, setUri] = useState('ipfs://chainbid/demo')
  const [reserve, setReserve] = useState('1')
  const [minutes, setMinutes] = useState('60')
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sell = async () => {
    if (address === undefined || publicClient === undefined) return
    setError(null)
    try {
      // Three transactions: mint the token, approve the escrow, open the
      // auction. Both ids are read back from logs — the token id from the mint's
      // Transfer, the auction id from AuctionCreated.
      setStep('1/3 minting…')
      const mintHash = await writeContract.mutateAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: 'safeMint',
        args: [address, uri],
        chainId: CHAIN_ID,
      })
      const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash })
      const [minted] = parseEventLogs({
        abi: NFT_ABI,
        eventName: 'Transfer',
        logs: mintReceipt.logs,
      })
      if (minted === undefined) throw new Error('Transfer log missing')
      const tokenId = minted.args.tokenId

      setStep('2/3 approving escrow…')
      const approveHash = await writeContract.mutateAsync({
        address: NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: 'approve',
        args: [AUCTION_ADDRESS, tokenId],
        chainId: CHAIN_ID,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })

      setStep('3/3 creating auction…')
      const createHash = await writeContract.mutateAsync({
        address: AUCTION_ADDRESS,
        abi: AUCTION_ABI,
        functionName: 'createAuction',
        args: [NFT_ADDRESS, tokenId, parseEther(reserve), BigInt(Number(minutes) * 60)],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash })
      const [created] = parseEventLogs({
        abi: AUCTION_ABI,
        eventName: 'AuctionCreated',
        logs: receipt.logs,
      })
      if (created === undefined) throw new Error('AuctionCreated log missing')

      setStep(null)
      void navigate({
        to: '/auction/$contractAddress/$auctionId',
        params: {
          contractAddress: AUCTION_ADDRESS.toLowerCase(),
          auctionId: String(created.args.auctionId),
        },
      })
    } catch (err) {
      setStep(null)
      setError(err instanceof Error ? err.message.split('\n')[0]! : String(err))
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Mint & sell</h1>
      <p className="text-sm text-zinc-400">
        Mints an NFT, approves the auction contract as escrow, and opens an English auction — three
        wallet confirmations.
      </p>

      <label className="block text-sm">
        <span className="text-zinc-400">Token URI</span>
        <input
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-400">Reserve price (ETH)</span>
        <input
          value={reserve}
          onChange={(e) => setReserve(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-400">Duration (minutes)</span>
        <input
          value={minutes}
          type="number"
          min={MIN_DURATION_MINUTES}
          onChange={(e) => setMinutes(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
        />
        {/* Anything shorter would be extended by its own first bid, so the contract
            refuses it outright. */}
        <span className="mt-1 block text-xs text-zinc-500">
          At least {MIN_DURATION_MINUTES} minutes.
        </span>
      </label>

      <button
        onClick={() => void sell()}
        disabled={!isConnected || step !== null}
        className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {step ?? 'Mint & create auction'}
      </button>
      {!isConnected && <p className="text-sm text-zinc-500">Connect a wallet first.</p>}
      {error !== null && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
