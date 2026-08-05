import { Module } from '@nestjs/common'
import { AuctionsController } from './auctions.controller.js'
import { AuctionsService } from './auctions.service.js'

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService],
})
export class AuctionsModule {}
