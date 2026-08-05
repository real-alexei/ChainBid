import { createDb } from '@chainbid/db'
import { Global, Module } from '@nestjs/common'
import { JsonRpcProvider } from 'ethers'
import { createClient } from 'redis'
import { ENV, loadEnv, type Env } from './env.js'

export const REDIS = Symbol('REDIS')
export const REDIS_SUB = Symbol('REDIS_SUB')
export const DB = Symbol('DB')
export const RPC = Symbol('RPC')

export type RedisClient = ReturnType<typeof createClient>

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: loadEnv },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const client = createClient({ url: env.redisUrl })
        await client.connect()
        return client
      },
    },
    {
      // A Redis connection in subscriber mode cannot run regular commands,
      // so the pub/sub listener gets its own connection.
      provide: REDIS_SUB,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const client = createClient({ url: env.redisUrl })
        await client.connect()
        return client
      },
    },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.databaseUrl),
    },
    {
      // Only health and metrics talk to the chain from the api.
      provide: RPC,
      inject: [ENV],
      useFactory: (env: Env) => new JsonRpcProvider(env.rpcUrl),
    },
  ],
  exports: [ENV, REDIS, REDIS_SUB, DB, RPC],
})
export class InfraModule {}
