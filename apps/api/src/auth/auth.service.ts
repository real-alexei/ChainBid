import type { Db } from '@chainbid/db'
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { generateNonce, SiweMessage } from 'siwe'
import { ENV, type Env } from '../env.js'
import { DB, REDIS, type RedisClient } from '../infra.module.js'

const NONCE_TTL_SECONDS = 300

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async createNonce(): Promise<string> {
    const nonce = generateNonce()
    await this.redis.set(`siwe:nonce:${nonce}`, '1', { EX: NONCE_TTL_SECONDS })
    return nonce
  }

  async verify(message: string, signature: string): Promise<{ token: string; address: string }> {
    let siwe: SiweMessage
    try {
      siwe = new SiweMessage(message)
    } catch {
      throw new UnauthorizedException('malformed SIWE message')
    }

    // GETDEL claims the nonce atomically, so each one is single-use even when
    // two verify calls race with the same message.
    const claimed = await this.redis.getDel(`siwe:nonce:${siwe.nonce}`)
    if (claimed === null) throw new UnauthorizedException('unknown or expired nonce')

    if (siwe.chainId !== this.env.chainId) throw new UnauthorizedException('wrong chain')

    const result = await siwe.verify({ signature, domain: this.env.siweDomain }).catch(() => null)
    if (result === null || !result.success) {
      throw new UnauthorizedException('signature verification failed')
    }

    const address = siwe.address.toLowerCase()
    await this.db
      .insertInto('users')
      .values({ wallet_address: address })
      .onConflict((oc) => oc.column('wallet_address').doNothing())
      .execute()

    const token = await this.jwt.signAsync({ sub: address })
    return { token, address }
  }
}
