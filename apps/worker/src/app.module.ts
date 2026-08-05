import { createDb } from '@chainbid/db'
import { Module } from '@nestjs/common'
import { Kafka, logLevel } from 'kafkajs'
import { ENV, loadEnv, type Env } from './env.js'
import { ProjectionService } from './projection.service.js'
import { DB, KAFKA } from './tokens.js'

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
    ProjectionService,
  ],
})
export class AppModule {}
