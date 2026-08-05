import { Module } from '@nestjs/common'
import { AuctionsController } from './auctions.controller.js'
import { AuctionsGateway } from './auctions.gateway.js'
import { AuctionsResolver } from './auctions.resolver.js'
import { AuctionsService } from './auctions.service.js'

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsResolver, AuctionsGateway],
  exports: [AuctionsService],
})
export class AuctionsModule {}
