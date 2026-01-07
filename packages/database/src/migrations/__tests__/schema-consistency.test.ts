import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Schema Consistency Tests
 *
 * These tests ensure that all migrations that define setup_tenant_schema
 * include all required columns. This prevents regressions where a migration
 * overwrites the function without including all columns.
 *
 * Background: Migration 020 accidentally removed sync_status column from
 * setup_tenant_schema, causing new tenant schemas to be missing the column.
 */
describe('setup_tenant_schema consistency', () => {
  const REQUIRED_WHATSAPP_CONNECTIONS_COLUMNS = [
    'id',
    'name',
    'phone_number',
    'jid',
    'status',
    'connected_by',
    'connected_at',
    'last_sync_at',
    'sync_status', // CRITICAL - must be present (added in migration 024)
    'connection_order',
    'created_at',
    'updated_at',
  ]

  const REQUIRED_CONTACTS_COLUMNS = [
    'id',
    'whatsapp_connection_id',
    'jid',
    'phone_number',
    'push_name',
    'custom_name',
    'is_group',
    'profile_picture_url',
    'is_online',
    'last_seen',
    'created_at',
    'updated_at',
  ]

  const REQUIRED_MESSAGES_COLUMNS = [
    'id',
    'whatsapp_connection_id',
    'contact_id',
    'message_id',
    'from_me',
    'message_type',
    'content',
    'status',
    'timestamp',
    'created_at',
  ]

  it('should include all required whatsapp_connections columns in the latest setup_tenant_schema', () => {
    const migrationsDir = join(__dirname, '..')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test') && !f.includes('helpers'))
      .sort()
      .reverse()

    let foundSetupFunction = false

    // Find the latest migration that defines setup_tenant_schema
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf-8')
      if (content.includes('CREATE OR REPLACE FUNCTION setup_tenant_schema')) {
        foundSetupFunction = true

        // Check for whatsapp_connections table definition
        // Use a more comprehensive regex that captures until the closing ', schema_name);'
        const match = content.match(
          /CREATE TABLE IF NOT EXISTS %I\.whatsapp_connections\s*\([^;]+?\)\s*'\s*,\s*schema_name\s*\)/si,
        )

        expect(match).not.toBeNull()
        if (match) {
          const tableDefinition = match[0].toLowerCase()
          for (const col of REQUIRED_WHATSAPP_CONNECTIONS_COLUMNS) {
            expect(tableDefinition).toContain(col.toLowerCase())
          }
        }

        // Only check the latest migration that has setup_tenant_schema
        break
      }
    }

    expect(foundSetupFunction).toBe(true)
  })

  it('should include all required contacts columns in the latest setup_tenant_schema', () => {
    const migrationsDir = join(__dirname, '..')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test') && !f.includes('helpers'))
      .sort()
      .reverse()

    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf-8')
      if (content.includes('CREATE OR REPLACE FUNCTION setup_tenant_schema')) {
        // Check for contacts table definition
        const match = content.match(/CREATE TABLE IF NOT EXISTS %I\.contacts\s*\([^;]+?\)\s*'\s*,\s*schema_name\s*\)/si)

        expect(match).not.toBeNull()
        if (match) {
          const tableDefinition = match[0].toLowerCase()
          for (const col of REQUIRED_CONTACTS_COLUMNS) {
            expect(tableDefinition).toContain(col.toLowerCase())
          }
        }
        break
      }
    }
  })

  it('should include all required messages columns in the latest setup_tenant_schema', () => {
    const migrationsDir = join(__dirname, '..')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test') && !f.includes('helpers'))
      .sort()
      .reverse()

    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf-8')
      if (content.includes('CREATE OR REPLACE FUNCTION setup_tenant_schema')) {
        // Check for messages table definition
        const match = content.match(/CREATE TABLE IF NOT EXISTS %I\.messages\s*\([^;]+?\)\s*'\s*,\s*schema_name\s*\)/si)

        expect(match).not.toBeNull()
        if (match) {
          const tableDefinition = match[0].toLowerCase()
          for (const col of REQUIRED_MESSAGES_COLUMNS) {
            expect(tableDefinition).toContain(col.toLowerCase())
          }
        }
        break
      }
    }
  })

  it('should have setup_tenant_schema defined in at least one migration', () => {
    const migrationsDir = join(__dirname, '..')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test') && !f.includes('helpers'))

    let found = false
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf-8')
      if (content.includes('CREATE OR REPLACE FUNCTION setup_tenant_schema')) {
        found = true
        break
      }
    }

    expect(found).toBe(true)
  })
})
