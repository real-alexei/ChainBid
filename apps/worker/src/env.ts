export const ENV = Symbol('ENV')

export interface Env {
  databaseUrl: string
  kafkaBrokers: string[]
  redisUrl: string
  rpcUrl: string
  settlerPrivateKey: string
}

export function loadEnv(): Env {
  return {
    databaseUrl: required('DATABASE_URL'),
    kafkaBrokers: required('KAFKA_BROKERS').split(','),
    redisUrl: required('REDIS_URL'),
    rpcUrl: required('RPC_URL'),
    settlerPrivateKey: required('SETTLER_PRIVATE_KEY'),
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`missing required env var ${name}`)
  }
  return value
}
