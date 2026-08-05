import { sql, type Db } from '@chainbid/db'
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import type { JsonRpcProvider } from 'ethers'
import { DB, REDIS, RPC, type RedisClient } from '../infra.module.js'

interface Health {
  status: 'ok' | 'degraded'
  checks: {
    postgres: 'up' | 'down'
    redis: 'up' | 'down'
    rpc: 'up' | 'down'
    /** Confirmed head minus the indexer cursor; null while either is down. */
    indexerLagBlocks: number | null
  }
}

// Kafka is deliberately absent: the api never touches it, so its health is
// the worker's business, not this endpoint's.
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(RPC) private readonly rpc: JsonRpcProvider,
  ) {}

  @Get()
  async health(): Promise<Health> {
    const [postgres, redis, head, cursor] = await Promise.all([
      sql`select 1`
        .execute(this.db)
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
      this.redis
        .ping()
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
      this.rpc.getBlockNumber().catch(() => null),
      this.db
        .selectFrom('indexer_state')
        .select(({ fn }) => fn.max('last_block_number').as('last'))
        .executeTakeFirst()
        .catch(() => undefined),
    ])

    const rpc = head === null ? 'down' : 'up'
    const indexerLagBlocks =
      head === null || cursor?.last == null ? null : head - Number(cursor.last)

    const body: Health = {
      status: postgres === 'up' && redis === 'up' && rpc === 'up' ? 'ok' : 'degraded',
      checks: { postgres, redis, rpc, indexerLagBlocks },
    }
    if (body.status !== 'ok') throw new ServiceUnavailableException(body)
    return body
  }
}
