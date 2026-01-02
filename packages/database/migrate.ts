import { Pool } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import { runMigrations } from './src/migrator'

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/whatsapp_web'

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
  })

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool,
    }),
  })

  console.log('Running migrations...')
  console.log('Database URL:', databaseUrl.replace(/:[^:@]+@/, ':****@'))

  await runMigrations(db)

  await db.destroy()
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
