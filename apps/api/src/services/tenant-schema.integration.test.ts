import { describe, expect, test } from "bun:test";
import {
  db,
  reconcileTenantSchema,
  TENANT_SCHEMA_CONTRACT,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("new tenant schema contract", () => {
  integrationTest(
    "preserves legacy label and catalog data while reconciling",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const catalogRowId = crypto.randomUUID();
      const table = (name: string) => sql.table(`${schemaName}.${name}`);

      try {
        // Call the historical function directly to model a tenant created before
        // the centralized reconciliation path was introduced.
        await sql`SELECT setup_tenant_schema(${schemaName})`.execute(db);
        await sql`
          INSERT INTO ${table("whatsapp_labels")} (whatsapp_label_id, name)
          VALUES ('external-label', 'Priority')
        `.execute(db);
        await sql`
          INSERT INTO ${table("whatsapp_catalogs")} (id, catalog_id, name)
          VALUES (${catalogRowId}, 'external-catalog', 'Main catalog')
        `.execute(db);
        await sql`
          INSERT INTO ${table("catalog_products")}
            (catalog_id, product_id, name, image_url)
          VALUES (${catalogRowId}, 'product-1', 'Product', 'https://img.test/1')
        `.execute(db);

        await reconcileTenantSchema(db, schemaName);
        const tenantDb = getTenantConnection(companyId);
        const label = await tenantDb
          .selectFrom("whatsapp_labels")
          .select("label_id")
          .executeTakeFirstOrThrow();
        const product = await tenantDb
          .selectFrom("catalog_products")
          .select(["catalog_id", "image_urls"])
          .executeTakeFirstOrThrow();

        expect(label.label_id).toBe("external-label");
        expect(product.catalog_id).toBe("external-catalog");
        expect(product.image_urls).toEqual(["https://img.test/1"]);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "creates every table and column required by TenantDatabase",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const result = await sql<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: "YES" | "NO";
        }>`
          SELECT table_name, column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ${schemaName}
        `.execute(db);

        const actualColumns = new Map<string, Set<string>>();
        for (const row of result.rows) {
          const columns =
            actualColumns.get(row.table_name) ?? new Set<string>();
          columns.add(row.column_name);
          actualColumns.set(row.table_name, columns);
        }

        const missing: string[] = [];
        for (const [table, expectedColumns] of Object.entries(
          TENANT_SCHEMA_CONTRACT,
        )) {
          const columns = actualColumns.get(table);
          if (!columns) {
            missing.push(`${table}.*`);
            continue;
          }
          for (const column of expectedColumns) {
            if (!columns.has(column)) missing.push(`${table}.${column}`);
          }
        }

        expect(missing).toEqual([]);

        const column = (table: string, name: string) =>
          result.rows.find(
            (row) => row.table_name === table && row.column_name === name,
          );
        expect(column("catalog_products", "catalog_id")?.data_type).toBe(
          "character varying",
        );
        expect(column("whatsapp_labels", "label_id")?.is_nullable).toBe("NO");
        expect(
          column("whatsapp_labels", "whatsapp_connection_id")?.data_type,
        ).toBe("uuid");
        expect(
          column("whatsapp_catalogs", "whatsapp_connection_id")?.data_type,
        ).toBe("uuid");
        expect(
          column("catalog_products", "whatsapp_connection_id")?.data_type,
        ).toBe("uuid");
        expect(column("whatsapp_catalogs", "name")?.is_nullable).toBe("NO");
        expect(column("whatsapp_labels", "whatsapp_label_id")).toBeUndefined();
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

/**
 * Realtime fan-out for contact-identity events resolves "which conversations
 * does this JID appear in" from group membership. Without this index that is a
 * sequential scan on every profile-picture event, so a newly created tenant
 * has to get it from `reconcileTenantSchema` - not only after the next
 * migration run.
 */
describe("group membership lookup is indexed", () => {
  integrationTest(
    "a newly created tenant has the participant_jid index",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        const indexes = await sql<{ indexname: string; indexdef: string }>`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = ${schemaName}
            AND tablename = 'group_participants'
        `.execute(db);

        const jidIndex = indexes.rows.find((row) =>
          row.indexdef.includes("participant_jid"),
        );
        expect(jidIndex).toBeDefined();
        // PostgreSQL truncates identifiers at 63 bytes; a collision there
        // would silently leave only one of several indexes created.
        expect(jidIndex?.indexname.length).toBeLessThanOrEqual(63);
        expect(jidIndex?.indexname).toBe(`${schemaName}_gp_jid_idx`);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "a tenant created by the historical function gains it on reconcile",
    async () => {
      // Models an existing tenant that predates migration 062.
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await sql`SELECT setup_tenant_schema(${schemaName})`.execute(db);
        const before = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = ${schemaName}
            AND indexname = ${`${schemaName}_gp_jid_idx`}
        `.execute(db);
        expect(before.rows).toHaveLength(0);

        await reconcileTenantSchema(db, schemaName);

        const after = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = ${schemaName}
            AND indexname = ${`${schemaName}_gp_jid_idx`}
        `.execute(db);
        expect(after.rows).toHaveLength(1);

        // Reconcile must stay idempotent - it runs on every tenant creation.
        await reconcileTenantSchema(db, schemaName);
        const again = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = ${schemaName}
            AND indexname = ${`${schemaName}_gp_jid_idx`}
        `.execute(db);
        expect(again.rows).toHaveLength(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});
