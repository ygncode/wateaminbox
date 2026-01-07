import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add indexes to whatsapp_sessions schema
  await sql`
    CREATE INDEX IF NOT EXISTS idx_whatsmeow_app_state_sync_keys_timestamp 
    ON whatsapp_sessions.whatsmeow_app_state_sync_keys (connection_id, jid, timestamp DESC)
  `.execute(db)

  // 2. Add indexes to all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db)

  for (const { schema_name } of schemas.rows) {
    const safeSchemaName = schema_name.replace(/-/g, '_')
    
    // Index for message cleanup service
    // Optimizes: .where("status", "=", "pending").where("from_me", "=", true).where("timestamp", "<", ...)
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`idx_${safeSchemaName.substring(0, 40)}_msg_cleanup`)}
      ON ${sql.raw(`"${schema_name}".messages`)} (status, from_me, timestamp)
      WHERE status = 'pending' AND from_me = true
    `.execute(db)

    // Index for response time analytics
    // Optimizes: subqueries filtering by contact_id, from_me=true, and timestamp range
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`idx_${safeSchemaName.substring(0, 40)}_msg_resp_time`)}
      ON ${sql.raw(`"${schema_name}".messages`)} (contact_id, from_me, timestamp)
    `.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Remove index from whatsapp_sessions
  await sql`
    DROP INDEX IF EXISTS whatsapp_sessions.idx_whatsmeow_app_state_sync_keys_timestamp
  `.execute(db)

  // Remove indexes from tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db)

  for (const { schema_name } of schemas.rows) {
    const safeSchemaName = schema_name.replace(/-/g, '_')

    await sql`
      DROP INDEX IF EXISTS ${sql.raw(`"${schema_name}".idx_${safeSchemaName.substring(0, 40)}_msg_cleanup`)}
    `.execute(db)

    await sql`
      DROP INDEX IF EXISTS ${sql.raw(`"${schema_name}".idx_${safeSchemaName.substring(0, 40)}_msg_resp_time`)}
    `.execute(db)
  }
}
