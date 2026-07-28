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
        expect(column("whatsapp_catalogs", "name")?.is_nullable).toBe("NO");
        expect(column("whatsapp_labels", "whatsapp_label_id")).toBeUndefined();
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});
