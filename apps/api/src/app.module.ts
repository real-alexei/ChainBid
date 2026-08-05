import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo'
import { Module } from '@nestjs/common'
import { GraphQLModule } from '@nestjs/graphql'
import { AuctionsModule } from './auctions/auctions.module.js'
import { AuthModule } from './auth/auth.module.js'
import { InfraModule } from './infra.module.js'

@Module({
  imports: [
    InfraModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // schema is generated from the code-first models at startup
      autoSchemaFile: true,
      sortSchema: true,
    }),
    AuthModule,
    AuctionsModule,
  ],
})
export class AppModule {}
