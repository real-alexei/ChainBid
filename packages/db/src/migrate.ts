import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kysely } from 'kysely'
import { FileMigrationProvider, Migrator } from 'kysely/migration'
import { createDb } from './client.js'
import type { DB } from './schema.js'

const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

export function createMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  })
}

export async function migrateToLatest(connectionString: string): Promise<void> {
  const db = createDb(connectionString)
  const migrator = createMigrator(db)

  try {
    const { error, results } = await migrator.migrateToLatest()

    for (const result of results ?? []) {
      const label = `${result.migrationName} (${result.direction})`
      if (result.status === 'Success') {
        console.log(`applied  ${label}`)
      } else if (result.status === 'Error') {
        console.error(`failed   ${label}`)
      }
    }

    if (error !== undefined) throw error
    if ((results ?? []).length === 0) console.log('already up to date')
  } finally {
    await db.destroy()
  }
}
