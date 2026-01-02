import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Migrator, FileMigrationProvider, type Kysely } from 'kysely'

export async function runMigrations(db: Kysely<unknown>) {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`Migration "${result.migrationName}" executed successfully`)
    } else if (result.status === 'Error') {
      console.error(`Migration "${result.migrationName}" failed`)
    }
  }

  if (error) {
    console.error('Migration failed')
    console.error(error)
    process.exit(1)
  }

  console.log('All migrations completed successfully')
}

export async function rollbackMigration(db: Kysely<unknown>) {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  })

  const { error, results } = await migrator.migrateDown()

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`Rolled back migration "${result.migrationName}" successfully`)
    } else if (result.status === 'Error') {
      console.error(`Rollback of "${result.migrationName}" failed`)
    }
  }

  if (error) {
    console.error('Rollback failed')
    console.error(error)
    process.exit(1)
  }
}
