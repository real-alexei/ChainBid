import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

export interface AuthedRequest extends Request {
  address?: string
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>()
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    if (scheme !== 'Bearer' || token === undefined) throw new UnauthorizedException()

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token)
      request.address = payload.sub
    } catch {
      throw new UnauthorizedException()
    }
    return true
  }
}
