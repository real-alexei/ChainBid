import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { InfraModule } from './infra.module.js'

@Module({
  imports: [InfraModule, AuthModule],
})
export class AppModule {}
