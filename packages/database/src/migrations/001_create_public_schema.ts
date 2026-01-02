import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Enable required extensions
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db)
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`.execute(db)

  // Create custom types
  await sql`
    DO $$ BEGIN
      CREATE TYPE company_status AS ENUM ('active', 'suspended', 'deleted');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `.execute(db)

  await sql`
    DO $$ BEGIN
      CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `.execute(db)

  // Companies table
  await db.schema
    .createTable('companies')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('schema_name', 'varchar(100)', (col) => col.unique().notNull())
    .addColumn('status', sql`company_status`, (col) => col.defaultTo('active').notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('email', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('email_verified_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Company members table
  await db.schema
    .createTable('company_members')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('company_id', 'uuid', (col) => col.references('companies.id').onDelete('cascade').notNull())
    .addColumn('role', sql`member_role`, (col) => col.defaultTo('member').notNull())
    .addColumn('permissions', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('invited_by', 'uuid', (col) => col.references('users.id'))
    .addColumn('joined_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Unique constraint for user-company combination
  await db.schema
    .createIndex('company_members_user_company_unique')
    .on('company_members')
    .columns(['user_id', 'company_id'])
    .unique()
    .execute()

  // Invitations table
  await db.schema
    .createTable('invitations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('company_id', 'uuid', (col) => col.references('companies.id').onDelete('cascade').notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull())
    .addColumn('token', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('invited_by', 'uuid', (col) => col.references('users.id').notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Company stats table (materialized view data)
  await db.schema
    .createTable('company_stats')
    .addColumn('company_id', 'uuid', (col) => col.primaryKey().references('companies.id').onDelete('cascade'))
    .addColumn('total_messages', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('total_contacts', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('active_users', 'integer', (col) => col.defaultTo(0).notNull())
    .addColumn('last_message_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .execute()

  // User sessions table
  await db.schema
    .createTable('user_sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('device_name', 'varchar(255)')
    .addColumn('device_type', 'varchar(50)')
    .addColumn('ip_address', sql`inet`)
    .addColumn('user_agent', 'text')
    .addColumn('refresh_token', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('last_active_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute()

  // Create indexes
  await db.schema.createIndex('users_email_idx').on('users').column('email').execute()
  await db.schema.createIndex('company_members_user_id_idx').on('company_members').column('user_id').execute()
  await db.schema.createIndex('company_members_company_id_idx').on('company_members').column('company_id').execute()
  await db.schema.createIndex('invitations_token_idx').on('invitations').column('token').execute()
  await db.schema.createIndex('user_sessions_user_id_idx').on('user_sessions').column('user_id').execute()
  await db.schema.createIndex('user_sessions_refresh_token_idx').on('user_sessions').column('refresh_token').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_sessions').ifExists().execute()
  await db.schema.dropTable('company_stats').ifExists().execute()
  await db.schema.dropTable('invitations').ifExists().execute()
  await db.schema.dropTable('company_members').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
  await db.schema.dropTable('companies').ifExists().execute()
  await sql`DROP TYPE IF EXISTS member_role`.execute(db)
  await sql`DROP TYPE IF EXISTS company_status`.execute(db)
}
