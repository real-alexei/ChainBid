import type { Db } from '@chainbid/db'
import { Inject, Injectable } from '@nestjs/common'
import type { JsonRpcProvider } from 'ethers'
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client'
import { DB, RPC } from '../infra.module.js'

@Injectable()
export class MetricsService {
  readonly registry = new Registry()

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route pattern',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  })

  constructor(@Inject(DB) db: Db, @Inject(RPC) rpc: JsonRpcProvider) {
    collectDefaultMetrics({ register: this.registry })

    new Gauge({
      name: 'chainbid_indexer_lag_blocks',
      help: 'Confirmed chain head minus the indexer cursor',
      registers: [this.registry],
      // Computed on scrape rather than kept up to date in the background.
      async collect() {
        const [head, cursor] = await Promise.all([
          rpc.getBlockNumber().catch(() => null),
          db
            .selectFrom('indexer_state')
            .select(({ fn }) => fn.max('last_block_number').as('last'))
            .executeTakeFirst()
            .catch(() => undefined),
        ])
        if (head === null || cursor?.last == null) return
        this.set(head - Number(cursor.last))
      },
    })
  }

  metrics(): Promise<string> {
    return this.registry.metrics()
  }
}
