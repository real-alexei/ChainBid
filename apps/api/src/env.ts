export const ENV = Symbol('ENV')

export interface Env {
  databaseUrl: string
  redisUrl: string
  apiPort: number
  chainId: number
  jwtSecret: string
  siweDomain: string
}

export function loadEnv(): Env {
  return {
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    apiPort: Number(process.env['API_PORT'] ?? '3000'),
    chainId: Number(required('CHAIN_ID')),
    jwtSecret: required('JWT_SECRET'),
    siweDomain: required('SIWE_DOMAIN'),
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`missing required env var ${name}`)
  }
  return value
}
