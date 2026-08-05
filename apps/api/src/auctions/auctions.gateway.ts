import { auctionUpdateSchema, REDIS_CHANNELS } from '@chainbid/shared'
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayDisconnect,
} from '@nestjs/websockets'
import type { WebSocket } from 'ws'
import { REDIS_SUB, type RedisClient } from '../infra.module.js'

interface WsReply {
  event: string
  data: unknown
}

/**
 * Raw-WebSocket feed (no socket.io — the frontend uses the native client).
 * Clients send {"event":"subscribe","data":{"contractAddress":"0x…","auctionId":"1"}}
 * and receive auction.* frames published by the worker over Redis pub/sub, so the
 * feed works identically with any number of api instances behind a balancer.
 * Rooms are keyed by (contract, id) — a bare auctionId collides across deployments.
 */
@WebSocketGateway({ path: '/ws' })
export class AuctionsGateway implements OnApplicationBootstrap, OnGatewayDisconnect {
  private readonly logger = new Logger(AuctionsGateway.name)
  private readonly rooms = new Map<string, Set<WebSocket>>()
  private readonly memberships = new Map<WebSocket, Set<string>>()

  constructor(@Inject(REDIS_SUB) private readonly redisSub: RedisClient) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.redisSub.subscribe(REDIS_CHANNELS.auctionUpdates, (payload) => this.fanOut(payload))
  }

  @SubscribeMessage('subscribe')
  subscribe(@ConnectedSocket() client: WebSocket, @MessageBody() body: unknown): WsReply {
    const target = auctionRefFrom(body)
    if (target === null) return { event: 'error', data: { message: SUBSCRIBE_ERROR } }

    const key = roomKey(target.contractAddress, target.auctionId)
    let room = this.rooms.get(key)
    if (room === undefined) {
      room = new Set()
      this.rooms.set(key, room)
    }
    room.add(client)

    let joined = this.memberships.get(client)
    if (joined === undefined) {
      joined = new Set()
      this.memberships.set(client, joined)
    }
    joined.add(key)

    return { event: 'subscribed', data: target }
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() body: unknown): WsReply {
    const target = auctionRefFrom(body)
    if (target === null) return { event: 'error', data: { message: SUBSCRIBE_ERROR } }
    const key = roomKey(target.contractAddress, target.auctionId)
    this.rooms.get(key)?.delete(client)
    this.memberships.get(client)?.delete(key)
    return { event: 'unsubscribed', data: target }
  }

  handleDisconnect(client: WebSocket): void {
    const joined = this.memberships.get(client)
    if (joined === undefined) return
    for (const key of joined) this.rooms.get(key)?.delete(client)
    this.memberships.delete(client)
  }

  private fanOut(payload: string): void {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      this.logger.error('dropping pub/sub message with invalid JSON')
      return
    }
    const parsed = auctionUpdateSchema.safeParse(json)
    if (!parsed.success) {
      this.logger.error(`dropping invalid update: ${parsed.error.message}`)
      return
    }

    const update = parsed.data
    const room = this.rooms.get(roomKey(update.auction.contractAddress, update.auction.auctionId))
    if (room === undefined || room.size === 0) return

    const frame = JSON.stringify({ event: update.event, data: update.auction })
    for (const client of room) {
      if (client.readyState === client.OPEN) client.send(frame)
    }
  }
}

const SUBSCRIBE_ERROR =
  'contractAddress must be a 0x-prefixed hex address and auctionId a decimal string'

function roomKey(contractAddress: string, auctionId: string): string {
  return `${contractAddress.toLowerCase()}:${auctionId}`
}

function auctionRefFrom(body: unknown): { contractAddress: string; auctionId: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const { contractAddress, auctionId } = body as { contractAddress?: unknown; auctionId?: unknown }
  if (typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    return null
  }
  if (typeof auctionId !== 'string' || !/^\d+$/.test(auctionId)) return null
  return { contractAddress: contractAddress.toLowerCase(), auctionId }
}
