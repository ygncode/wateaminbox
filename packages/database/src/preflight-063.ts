/**
 * Read-only preflight for migration 063 (tenant index name normalization).
 *
 *   DATABASE_URL=... bun run packages/database/src/preflight-063.ts
 *
 * Changes nothing. Run it before the deploy window to learn whether the
 * migration will abort on duplicate rows, and which index builds will hold an
 * ACCESS EXCLUSIVE lock long enough to matter.
 *
 * Exits non-zero when duplicates would abort the migration, so it can gate a
 * pipeline step.
 */

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getTenantSchemas } from "./migrations/migration-helpers.js";
import {
  formatPreflightReport,
  preflightTenantIndexNames,
} from "./tenant-index-names.js";

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    return 2;
  }

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });

  try {
    const schemas = await getTenantSchemas(db);
    const report = await preflightTenantIndexNames(db, schemas);
    console.log(formatPreflightReport(report));
    return report.some((row) => row.blocked.length > 0) ? 1 : 0;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
