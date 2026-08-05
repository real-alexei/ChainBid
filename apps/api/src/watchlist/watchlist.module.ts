import { Module } from '@nestjs/common'
import { AuctionsModule } from '../auctions/auctions.module.js'
import { AuthModule } from '../auth/auth.module.js'
import { WatchlistController } from './watchlist.controller.js'
import { WatchlistService } from './watchlist.service.js'

@Module({
  imports: [AuthModule, AuctionsModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
