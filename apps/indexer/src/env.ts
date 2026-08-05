export const ENV = Symbol('ENV')

export interface Env {
  databaseUrl: string
  kafkaBrokers: string[]
  rpcUrl: string
  confirmations: number
  auctionAddress: string
}

export function loadEnv(): Env {
  return {
    databaseUrl: required('DATABASE_URL'),
    kafkaBrokers: required('KAFKA_BROKERS').split(','),
    rpcUrl: required('RPC_URL'),
    confirmations: Number(required('CONFIRMATIONS')),
    auctionAddress: required('AUCTION_ADDRESS').toLowerCase(),
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`missing required env var ${name}`)
  }
  return value
}
