import { createDb } from '@chainbid/db'
import { Module } from '@nestjs/common'
import { Kafka, logLevel } from 'kafkajs'
import { createClient } from 'redis'
import { ENV, loadEnv, type Env } from './env.js'
import { NotifierService } from './notifier.service.js'
import { ProjectionService } from './projection.service.js'
import { DB, KAFKA, REDIS } from './tokens.js'

export type RedisClient = ReturnType<typeof createClient>

@Module({
  providers: [
    { provide: ENV, useFactory: loadEnv },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) => createDb(env.databaseUrl),
    },
    {
      provide: KAFKA,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Kafka({
          clientId: 'chainbid-worker',
          brokers: env.kafkaBrokers,
          logLevel: logLevel.ERROR,
        }),
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const client = createClient({ url: env.redisUrl })
        await client.connect()
        return client
      },
    },
    ProjectionService,
    NotifierService,
  ],
})
export class AppModule {}
