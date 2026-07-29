import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Scope WhatsApp labels, catalogs, and products to their owning account.
 *
 * Legacy rows predate multi-account support. They are assigned to the oldest
 * usable account in the workspace so existing single-account installations
 * retain their data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const connections = sql.table(`${schemaName}.whatsapp_connections`);
    const labels = sql.table(`${schemaName}.whatsapp_labels`);
    const catalogs = sql.table(`${schemaName}.whatsapp_catalogs`);
    const products = sql.table(`${schemaName}.catalog_products`);

    await sql`
      ALTER TABLE ${labels}
      ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID
    `.execute(db);
    await sql`
      ALTER TABLE ${catalogs}
      ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID
    `.execute(db);
    await sql`
      ALTER TABLE ${products}
      ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID
    `.execute(db);

    await sql`
      UPDATE ${labels}
      SET whatsapp_connection_id = (
        SELECT id
        FROM ${connections}
        WHERE archived_at IS NULL
        ORDER BY (status = 'connected') DESC, created_at ASC
        LIMIT 1
      )
      WHERE whatsapp_connection_id IS NULL
    `.execute(db);
    await sql`
      UPDATE ${catalogs}
      SET whatsapp_connection_id = (
        SELECT id
        FROM ${connections}
        WHERE archived_at IS NULL
        ORDER BY (status = 'connected') DESC, created_at ASC
        LIMIT 1
      )
      WHERE whatsapp_connection_id IS NULL
    `.execute(db);
    await sql`
      UPDATE ${products} AS product
      SET whatsapp_connection_id = catalog.whatsapp_connection_id
      FROM ${catalogs} AS catalog
      WHERE product.whatsapp_connection_id IS NULL
        AND product.catalog_id = catalog.catalog_id
    `.execute(db);

    await sql`
      ALTER TABLE ${labels}
      DROP CONSTRAINT IF EXISTS ${sql.ref("whatsapp_labels_label_id_key")},
      DROP CONSTRAINT IF EXISTS ${sql.ref("unique_whatsapp_label")},
      DROP CONSTRAINT IF EXISTS whatsapp_labels_connection_fk
    `.execute(db);
    await sql`
      ALTER TABLE ${catalogs}
      DROP CONSTRAINT IF EXISTS ${sql.ref("whatsapp_catalogs_catalog_id_key")},
      DROP CONSTRAINT IF EXISTS whatsapp_catalogs_connection_fk
    `.execute(db);
    await sql`
      ALTER TABLE ${products}
      DROP CONSTRAINT IF EXISTS ${sql.ref(
        "catalog_products_product_id_catalog_id_key",
      )},
      DROP CONSTRAINT IF EXISTS catalog_products_connection_fk
    `.execute(db);
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_whatsapp_labels_label_uidx`,
      )}
    `.execute(db);

    await sql`
      ALTER TABLE ${labels}
      ADD CONSTRAINT whatsapp_labels_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${connections}(id)
      ON DELETE CASCADE
    `.execute(db);
    await sql`
      ALTER TABLE ${catalogs}
      ADD CONSTRAINT whatsapp_catalogs_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${connections}(id)
      ON DELETE CASCADE
    `.execute(db);
    await sql`
      ALTER TABLE ${products}
      ADD CONSTRAINT catalog_products_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${connections}(id)
      ON DELETE CASCADE
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_whatsapp_labels_connection_label_uidx`,
      )}
      ON ${labels} (whatsapp_connection_id, label_id)
      WHERE whatsapp_connection_id IS NOT NULL
    `.execute(db);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_whatsapp_labels_connection_tag_uidx`,
      )}
      ON ${labels} (whatsapp_connection_id, synced_tag_id)
      WHERE whatsapp_connection_id IS NOT NULL AND synced_tag_id IS NOT NULL
    `.execute(db);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_whatsapp_catalogs_connection_catalog_uidx`,
      )}
      ON ${catalogs} (whatsapp_connection_id, catalog_id)
      WHERE whatsapp_connection_id IS NOT NULL
    `.execute(db);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_catalog_products_connection_catalog_product_uidx`,
      )}
      ON ${products} (whatsapp_connection_id, catalog_id, product_id)
      WHERE whatsapp_connection_id IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const labels = sql.table(`${schemaName}.whatsapp_labels`);
    const catalogs = sql.table(`${schemaName}.whatsapp_catalogs`);
    const products = sql.table(`${schemaName}.catalog_products`);

    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_whatsapp_labels_connection_label_uidx`,
      )}
    `.execute(db);
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_whatsapp_labels_connection_tag_uidx`,
      )}
    `.execute(db);
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_whatsapp_catalogs_connection_catalog_uidx`,
      )}
    `.execute(db);
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_catalog_products_connection_catalog_product_uidx`,
      )}
    `.execute(db);

    await sql`
      ALTER TABLE ${products}
      DROP CONSTRAINT IF EXISTS catalog_products_connection_fk,
      DROP COLUMN IF EXISTS whatsapp_connection_id
    `.execute(db);
    await sql`
      ALTER TABLE ${catalogs}
      DROP CONSTRAINT IF EXISTS whatsapp_catalogs_connection_fk,
      DROP COLUMN IF EXISTS whatsapp_connection_id
    `.execute(db);
    await sql`
      ALTER TABLE ${labels}
      DROP CONSTRAINT IF EXISTS whatsapp_labels_connection_fk,
      DROP COLUMN IF EXISTS whatsapp_connection_id
    `.execute(db);
  });
}
