import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

// Repo-root .env, loaded with plain Node — no config framework. Absent in
// deployed environments, where variables come from the process environment.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

const app = await NestFactory.createApplicationContext(AppModule)
app.enableShutdownHooks()
