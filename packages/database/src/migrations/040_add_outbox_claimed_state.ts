import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE schema_record RECORD;
    BEGIN
      FOR schema_record IN
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE 'tenant_%'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.nats_outbox DROP CONSTRAINT IF EXISTS nats_outbox_status_check',
          schema_record.schema_name
        );
        EXECUTE format(
          'ALTER TABLE %I.nats_outbox ADD CONSTRAINT nats_outbox_status_check CHECK (status IN (''pending'', ''claimed'', ''published'', ''failed''))',
          schema_record.schema_name
        );
      END LOOP;
    END $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE schema_record RECORD;
    BEGIN
      FOR schema_record IN
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE 'tenant_%'
      LOOP
        EXECUTE format(
          'UPDATE %I.nats_outbox SET status = ''pending'' WHERE status = ''claimed''',
          schema_record.schema_name
        );
        EXECUTE format(
          'ALTER TABLE %I.nats_outbox DROP CONSTRAINT IF EXISTS nats_outbox_status_check',
          schema_record.schema_name
        );
        EXECUTE format(
          'ALTER TABLE %I.nats_outbox ADD CONSTRAINT nats_outbox_status_check CHECK (status IN (''pending'', ''published'', ''failed''))',
          schema_record.schema_name
        );
      END LOOP;
    END $$
  `.execute(db);
}
