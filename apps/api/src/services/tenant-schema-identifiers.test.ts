import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getTenantSchemaName,
  TENANT_INDEX_TARGETS,
} from "@wateaminbox/database";

/**
 * PostgreSQL truncates identifiers at 63 bytes, silently.
 *
 * A tenant schema name is already 43 characters (`tenant_` plus a UUID with
 * its dashes replaced), so a per-tenant index name has only 20 characters of
 * headroom. Exceeding it does not error: two differently-named indexes can
 * truncate to the same identifier, and `CREATE INDEX IF NOT EXISTS` then makes
 * the second one a silent no-op - including for UNIQUE indexes, where the
 * missing one is a missing data-integrity constraint.
 *
 * That is why this repository's newer tenant indexes use short prefixes
 * (`cc_`, `cs_`, `ca_`, `gp_`) instead of full table names.
 *
 * These run without a database so the invariant is checked on every test run,
 * not only when integration tests are enabled.
 */

const PG_IDENTIFIER_LIMIT = 63;

const DATABASE_SRC = new URL(
  "../../../../packages/database/src",
  import.meta.url,
).pathname;

/** A representative schema name - every tenant schema is exactly this long. */
const SCHEMA = getTenantSchemaName("3f2504e0-4f89-41d3-9a0c-0305e82c3301");

/**
 * The only historical over-length identifier that is NOT remediated by
 * migration 063.
 *
 * Current code merely DROPs this legacy index, so there is nothing to keep
 * correctly named. Everything else that overflows must appear in
 * TENANT_INDEX_TARGETS, which is what actually renames or rebuilds it.
 */
const UNREMEDIATED_BY_DESIGN = new Set(["_whatsapp_labels_label_uidx"]);

/** Legacy suffixes migration 063 knows how to fix. */
const REMEDIATED = new Set(
  TENANT_INDEX_TARGETS.map((target) => target.legacySuffix),
);

function tenantIdentifiersIn(source: string): string[] {
  // Matches the `${schemaName}_suffix` template literals used for index and
  // constraint names in migrations and the reconcile path.
  return [...source.matchAll(/\$\{schemaName\}(_[a-z0-9_]+)/g)].map(
    (match) => match[1],
  );
}

function sourceFiles(): Array<{ path: string; source: string }> {
  const files = [
    {
      path: "tenant-schema.ts",
      source: readFileSync(join(DATABASE_SRC, "tenant-schema.ts"), "utf8"),
    },
  ];
  for (const entry of readdirSync(join(DATABASE_SRC, "migrations"))) {
    if (!entry.endsWith(".ts")) continue;
    files.push({
      path: `migrations/${entry}`,
      source: readFileSync(join(DATABASE_SRC, "migrations", entry), "utf8"),
    });
  }
  return files;
}

function allIdentifierSuffixes(): Array<{ path: string; suffix: string }> {
  const found: Array<{ path: string; suffix: string }> = [];
  for (const file of sourceFiles()) {
    for (const suffix of tenantIdentifiersIn(file.source)) {
      found.push({ path: file.path, suffix });
    }
  }
  return found;
}

describe("tenant identifier names fit PostgreSQL's limit", () => {
  test("a tenant schema name leaves only 20 characters of headroom", () => {
    expect(SCHEMA).toHaveLength(43);
    expect(PG_IDENTIFIER_LIMIT - SCHEMA.length).toBe(20);
  });

  test("every over-length identifier is remediated by migration 063", () => {
    // Historical migrations are immutable, so the long names stay in the
    // source. What matters is that each one has a canonical replacement the
    // migration will rename or rebuild it into.
    const unhandled = allIdentifierSuffixes()
      .filter(
        ({ suffix }) =>
          `${SCHEMA}${suffix}`.length > PG_IDENTIFIER_LIMIT &&
          !REMEDIATED.has(suffix) &&
          !UNREMEDIATED_BY_DESIGN.has(suffix),
      )
      .map(({ path, suffix }) => `${path}: ${suffix}`);
    expect([...new Set(unhandled)]).toEqual([]);
  });

  test("every truncation collision is fully remediated", () => {
    // A collision is where indexes actually went missing, so every member of
    // a colliding family must be remediated - not just the one that won.
    const byTruncation = new Map<string, Set<string>>();
    for (const { suffix } of allIdentifierSuffixes()) {
      if (`${SCHEMA}${suffix}`.length <= PG_IDENTIFIER_LIMIT) continue;
      const truncated = `${SCHEMA}${suffix}`.slice(0, PG_IDENTIFIER_LIMIT);
      const group = byTruncation.get(truncated) ?? new Set<string>();
      group.add(suffix);
      byTruncation.set(truncated, group);
    }

    const unremediated: string[] = [];
    for (const group of byTruncation.values()) {
      if (group.size < 2) continue;
      for (const suffix of group) {
        if (!REMEDIATED.has(suffix)) unremediated.push(suffix);
      }
    }
    expect(unremediated).toEqual([]);
  });

  test("the canonical replacements themselves all fit", () => {
    const tooLong = TENANT_INDEX_TARGETS.filter(
      (target) => `${SCHEMA}${target.suffix}`.length > PG_IDENTIFIER_LIMIT,
    ).map((target) => target.suffix);
    expect(tooLong).toEqual([]);
  });

  test("the group-membership index name is short and agreed on", () => {
    // reconcileTenantSchema and migration 062 must produce the same name; a
    // mismatch would create two indexes on newly provisioned tenants.
    expect(`${SCHEMA}_gp_jid_idx`.length).toBeLessThanOrEqual(
      PG_IDENTIFIER_LIMIT,
    );
    expect(
      readFileSync(join(DATABASE_SRC, "tenant-schema.ts"), "utf8"),
    ).toContain("${schemaName}_gp_jid_idx");
    expect(
      readFileSync(
        join(DATABASE_SRC, "migrations/062_index_group_participant_jid.ts"),
        "utf8",
      ),
    ).toContain("${schemaName}_gp_jid_idx");
  });
});
