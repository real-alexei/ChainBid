import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { DB } from './schema.js'

// No custom type parsers here on purpose. node-pg returns numeric and int8 as
// strings, the generated types say the same, and anything that reshapes values
// at runtime would make those types lie. Convert explicitly at the call site.

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  })
}

export type Db = Kysely<DB>
