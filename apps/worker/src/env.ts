export const ENV = Symbol('ENV')

export interface Env {
  databaseUrl: string
  kafkaBrokers: string[]
  redisUrl: string
}

export function loadEnv(): Env {
  return {
    databaseUrl: required('DATABASE_URL'),
    kafkaBrokers: required('KAFKA_BROKERS').split(','),
    redisUrl: required('REDIS_URL'),
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`missing required env var ${name}`)
  }
  return value
}
