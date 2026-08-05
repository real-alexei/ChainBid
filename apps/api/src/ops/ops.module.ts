import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { MetricsController } from './metrics.controller.js'
import { MetricsService } from './metrics.service.js'

@Module({
  controllers: [HealthController, MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class OpsModule {}
