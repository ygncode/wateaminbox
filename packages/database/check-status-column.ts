import { db } from './src/index.js'
import { sql } from 'kysely'

async function checkAndFixStatusColumn() {
  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db)

  console.log('Found tenant schemas:', schemas.rows.map(r => r.schema_name))

  for (const { schema_name } of schemas.rows) {
    // Check if column exists
    const columnExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schema_name}
        AND table_name = 'messages'
        AND column_name = 'status'
      ) as exists
    `.execute(db)

    console.log(`Schema ${schema_name}: status column exists = ${columnExists.rows[0]?.exists}`)

    if (!columnExists.rows[0]?.exists) {
      console.log(`Adding status column to ${schema_name}.messages...`)
      await sql.raw(`
        ALTER TABLE "${schema_name}".messages
        ADD COLUMN IF NOT EXISTS status message_status DEFAULT 'sent'
      `).execute(db)
      console.log(`Added status column to ${schema_name}.messages`)
    }
  }

  await db.destroy()
}

checkAndFixStatusColumn().catch(console.error)
