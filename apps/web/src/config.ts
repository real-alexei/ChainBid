// Defaults match .env.example and a fresh hardhat node.
export const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000'
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'
export const NFT_ADDRESS = (import.meta.env['VITE_NFT_ADDRESS'] ??
  '0x5FbDB2315678afecb367f032d93F642f64180aa3') as `0x${string}`
export const AUCTION_ADDRESS = (import.meta.env['VITE_AUCTION_ADDRESS'] ??
  '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as `0x${string}`
export const SIWE_DOMAIN = 'localhost:5173'
export const CHAIN_ID = 31337
