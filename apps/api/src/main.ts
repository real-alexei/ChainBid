import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app.module.js'
import { ENV, type Env } from './env.js'

// Repo-root .env, loaded with plain Node — no config framework. Absent in
// deployed environments, where variables come from the process environment.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

const app = await NestFactory.create(AppModule)
app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
app.useWebSocketAdapter(new WsAdapter(app))

const env = app.get<Env>(ENV)
app.enableCors({ origin: `http://${env.siweDomain}` })

await app.listen(env.apiPort)
console.log(`api listening on :${env.apiPort}`)
