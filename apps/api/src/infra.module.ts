import { createDb } from '@chainbid/db'
import { Global, Module } from '@nestjs/common'
import { createClient } from 'redis'
import { ENV, loadEnv, type Env } from './env.js'

export const REDIS = Symbol('REDIS')
export const DB = Symbol('DB')

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
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.databaseUrl),
    },
  ],
  exports: [ENV, REDIS, DB],
})
export class InfraModule {}
