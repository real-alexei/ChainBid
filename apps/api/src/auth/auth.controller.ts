import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthedRequest } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { VerifyDto } from './verify.dto.js'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('nonce')
  async nonce(): Promise<{ nonce: string }> {
    return { nonce: await this.auth.createNonce() }
  }

  @Post('verify')
  verify(@Body() body: VerifyDto): Promise<{ token: string; address: string }> {
    return this.auth.verify(body.message, body.signature)
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthedRequest): { address: string } {
    if (request.address === undefined) throw new Error('guard did not set address')
    return { address: request.address }
  }
}
