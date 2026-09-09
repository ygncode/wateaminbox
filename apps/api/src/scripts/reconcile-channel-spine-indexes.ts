import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant\_%' ESCAPE '\\'
    ORDER BY schema_name
  `.execute(db);

  if (!apply) {
    console.log(
      `Dry run: ${schemas.rows.length} tenant schema(s) require catalog preflight. Re-run with --apply to build indexes concurrently.`,
    );
    return;
  }

  let blocked = false;
  for (const { schema_name: schemaName } of schemas.rows) {
    const results = await reconcileChannelSpineConcurrentIndexes(
      db,
      schemaName,
    );
    for (const result of results) {
      console.log(
        `${schemaName} ${result.indexName}: ${result.status}` +
          (result.duplicateGroups > 0
            ? ` (${result.duplicateGroups} duplicate key groups)`
            : ""),
      );
      if (result.status === "blocked") blocked = true;
    }
  }
  if (blocked) {
    throw new Error(
      "Channel spine index reconciliation is blocked by duplicate keys",
    );
  }
}

try {
  await main();
} finally {
  await db.destroy();
}
