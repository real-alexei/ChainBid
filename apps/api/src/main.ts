import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from './app.module.js'
import { ENV, type Env } from './env.js'
import { MetricsService } from './ops/metrics.service.js'

// Repo-root .env, loaded with plain Node — no config framework. Absent in
// deployed environments, where variables come from the process environment.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

const app = await NestFactory.create(AppModule)
app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
app.useWebSocketAdapter(new WsAdapter(app))

// Express-level so GraphQL requests are measured too; the route label uses
// the matched pattern (/auctions/:contract/:id), not the raw path — bounded cardinality.
const metrics = app.get(MetricsService)
app.use((req: Request, res: Response, next: NextFunction) => {
  const end = metrics.httpDuration.startTimer({ method: req.method })
  res.on('finish', () => {
    end({
      route: (req.route as { path?: string } | undefined)?.path ?? req.path,
      status: res.statusCode,
    })
  })
  next()
})

const env = app.get<Env>(ENV)
app.enableCors({ origin: `http://${env.siweDomain}` })

await app.listen(env.apiPort)
console.log(`api listening on :${env.apiPort}`)
