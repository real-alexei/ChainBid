import { migrateToLatest } from './migrate.js'

const connectionString = process.env['DATABASE_URL']
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

await migrateToLatest(connectionString)
