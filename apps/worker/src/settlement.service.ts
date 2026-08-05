import type { Db } from '@chainbid/db'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { ENV, type Env } from './env.js'
import { DB } from './tokens.js'

const SCAN_INTERVAL_MS = 10_000
const SETTLE_ABI = ['function settle(uint256 auctionId)']

/**
 * settle() is permissionless but somebody has to send the transaction; this
 * watcher does it for auctions whose end time has passed. Expiry is compared
 * against the chain clock, not the wall clock — on the dev chain they diverge
 * whenever the tests warp time.
 */
@Injectable()
export class SettlementService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementService.name)
  private readonly provider: JsonRpcProvider
  private readonly wallet: Wallet
  /** Auctions with a confirmed settle tx, skipped until the projection catches up. */
  private readonly settled = new Set<string>()
  private stopped = false
  private loop: Promise<void> = Promise.resolve()

  constructor(
    @Inject(ENV) env: Env,
    @Inject(DB) private readonly db: Db,
  ) {
    this.provider = new JsonRpcProvider(env.rpcUrl)
    this.wallet = new Wallet(env.settlerPrivateKey, this.provider)
  }

  onApplicationBootstrap(): void {
    this.logger.log(`settling as ${this.wallet.address}`)
    this.loop = this.run()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true
    await this.loop
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.tick()
      } catch (err) {
        this.logger.error(`scan failed: ${String(err)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, SCAN_INTERVAL_MS))
    }
  }

  private async tick(): Promise<void> {
    const head = await this.provider.getBlock('latest')
    if (head === null) return
    const chainNow = new Date(head.timestamp * 1000)

    const expired = await this.db
      .selectFrom('auctions')
      .select(['contract_address', 'auction_id'])
      .where('status', '=', 'live')
      .where('end_time', '<=', chainNow)
      .execute()

    for (const row of expired) {
      const key = `${row.contract_address}:${row.auction_id}`
      if (this.settled.has(key)) continue

      try {
        const auction = new Contract(row.contract_address, SETTLE_ABI, this.wallet)
        const tx = await auction['settle']!(BigInt(row.auction_id))
        await tx.wait()
        this.settled.add(key)
        this.logger.log(`settled auction ${row.auction_id} in tx ${tx.hash}`)
      } catch (err) {
        // Likely raced by another settler or a projection that lags the
        // chain; the next scan retries whatever is still live.
        this.logger.warn(`settle(${row.auction_id}) failed: ${String(err)}`)
      }
    }
  }
}
