import { describe, expect, test } from "bun:test";
import {
  formatDuplicateBlockers,
  getTenantSchemaName,
  legacyIdentifier,
  PG_IDENTIFIER_MAX_BYTES,
  targetIdentifier,
  TENANT_INDEX_TARGETS,
  TENANT_SCHEMA_NAME_LENGTH,
  TENANT_SUFFIX_BUDGET,
} from "@wateaminbox/database";

/**
 * Every per-tenant identifier must survive PostgreSQL's 63-byte limit intact.
 *
 * Truncation is silent, and two names that truncate alike collapse into one -
 * which is exactly how four indexes, two of them UNIQUE, came to be missing
 * from every tenant. These checks need no database, so the invariant holds on
 * every test run rather than only when integration tests are enabled.
 */

/** The longest schema name any tenant can have. */
const LONGEST_SCHEMA = getTenantSchemaName(
  "ffffffff-ffff-4fff-bfff-ffffffffffff",
);

describe("tenant schema names are a fixed, known length", () => {
  test("every UUID yields the same 43-character schema name", () => {
    const samples = [
      "00000000-0000-4000-8000-000000000000",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    ];
    for (const uuid of samples) {
      expect(getTenantSchemaName(uuid)).toHaveLength(TENANT_SCHEMA_NAME_LENGTH);
    }
    expect(LONGEST_SCHEMA).toHaveLength(43);
  });

  test("the suffix budget is what is actually left over", () => {
    expect(TENANT_SUFFIX_BUDGET).toBe(
      PG_IDENTIFIER_MAX_BYTES - TENANT_SCHEMA_NAME_LENGTH,
    );
    expect(TENANT_SUFFIX_BUDGET).toBe(20);
  });
});

describe("canonical index names fit and stay distinct", () => {
  test("every target identifier fits within the limit", () => {
    const tooLong = TENANT_INDEX_TARGETS.filter(
      (target) =>
        targetIdentifier(LONGEST_SCHEMA, target).length >
        PG_IDENTIFIER_MAX_BYTES,
    ).map((target) => target.suffix);
    expect(tooLong).toEqual([]);
  });

  test("identifiers are byte-safe, not just character-safe", () => {
    // Identifiers are ASCII by construction; assert it so a future non-ASCII
    // name cannot pass a character-length check and fail a byte-length one.
    for (const target of TENANT_INDEX_TARGETS) {
      const identifier = targetIdentifier(LONGEST_SCHEMA, target);
      expect(Buffer.byteLength(identifier, "utf8")).toBe(identifier.length);
      expect(identifier).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("no two targets share a suffix", () => {
    const suffixes = TENANT_INDEX_TARGETS.map((target) => target.suffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  test("no two target identifiers collide, even truncated", () => {
    const truncated = TENANT_INDEX_TARGETS.map((target) =>
      targetIdentifier(LONGEST_SCHEMA, target).slice(
        0,
        PG_IDENTIFIER_MAX_BYTES,
      ),
    );
    expect(new Set(truncated).size).toBe(truncated.length);
  });

  test("names are deterministic across tenants", () => {
    const a = getTenantSchemaName("00000000-0000-4000-8000-000000000000");
    const b = getTenantSchemaName("ffffffff-ffff-4fff-bfff-ffffffffffff");
    for (const target of TENANT_INDEX_TARGETS) {
      expect(targetIdentifier(a, target)).toBe(`${a}${target.suffix}`);
      expect(targetIdentifier(b, target)).toBe(`${b}${target.suffix}`);
      expect(targetIdentifier(a, target)).not.toBe(targetIdentifier(b, target));
    }
  });
});

describe("legacy identifiers describe what tenants actually have", () => {
  test("every legacy name was over the limit, so it truncates", () => {
    // If one were already short, renaming it would be pointless churn.
    for (const target of TENANT_INDEX_TARGETS) {
      const intended = `${LONGEST_SCHEMA}${target.legacySuffix}`;
      expect(intended.length).toBeGreaterThan(PG_IDENTIFIER_MAX_BYTES);
      expect(legacyIdentifier(LONGEST_SCHEMA, target)).toBe(
        intended.slice(0, PG_IDENTIFIER_MAX_BYTES),
      );
    }
  });

  test("the historical truncation collisions are represented", () => {
    // These three families are why indexes went missing; the target list must
    // still contain every member so each one gets rebuilt or renamed.
    const byTruncation = new Map<string, string[]>();
    for (const target of TENANT_INDEX_TARGETS) {
      const key = legacyIdentifier(LONGEST_SCHEMA, target);
      byTruncation.set(key, [...(byTruncation.get(key) ?? []), target.suffix]);
    }
    const groups = [...byTruncation.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.sort().join(","));
    expect(groups.sort()).toEqual(
      [
        "_sm_bulk_job_idx,_sm_contact_idx,_sm_due_idx",
        "_wconn_phone_uidx,_wconn_status_idx",
        "_wl_conn_label_uidx,_wl_conn_tag_uidx",
      ].sort(),
    );
  });

  test("every collision family resolves to distinct canonical names", () => {
    const canonical = TENANT_INDEX_TARGETS.map((target) =>
      targetIdentifier(LONGEST_SCHEMA, target),
    );
    expect(new Set(canonical).size).toBe(canonical.length);
  });
});

describe("target definitions are self-consistent", () => {
  test("each target names columns and a purpose", () => {
    for (const target of TENANT_INDEX_TARGETS) {
      expect(target.columns.length).toBeGreaterThan(0);
      expect(target.purpose.length).toBeGreaterThan(0);
      expect(target.table.length).toBeGreaterThan(0);
    }
  });

  test("createColumns, when present, matches the compared columns", () => {
    // The catalog stores bare column names; ordering modifiers like DESC live
    // only in the CREATE statement. A mismatch would make an existing index
    // look unmatchable and get rebuilt every run.
    for (const target of TENANT_INDEX_TARGETS) {
      if (!target.createColumns) continue;
      expect(
        target.createColumns.map((column) => column.split(" ")[0]),
      ).toEqual([...target.columns]);
    }
  });

  test("a UNIQUE constraint target is the only constraint-backed one", () => {
    const constraints = TENANT_INDEX_TARGETS.filter(
      (target) => target.constraint,
    );
    expect(constraints.map((target) => target.suffix)).toEqual([
      "_msg_wa_uniq",
    ]);
    // A constraint is always UNIQUE here; a non-unique one would need a plain
    // index instead of ALTER TABLE ADD CONSTRAINT.
    for (const target of constraints) expect(target.unique).toBe(true);
  });

  test("the two integrity-critical UNIQUE indexes are covered", () => {
    const unique = TENANT_INDEX_TARGETS.filter((target) => target.unique).map(
      (target) => target.suffix,
    );
    expect(unique).toContain("_wconn_phone_uidx");
    expect(unique).toContain("_wl_conn_tag_uidx");
  });
});

describe("duplicate reporting is operator-readable and data-safe", () => {
  test("names the guarantee, the key, and the scale without dumping rows", () => {
    const message = formatDuplicateBlockers([
      {
        schemaName: "tenant_abc",
        table: "whatsapp_connections",
        indexName: "tenant_abc_wconn_phone_uidx",
        columns: ["phone_number"],
        purpose: "one WhatsApp connection per phone number",
        samples: [{ phone_number: "15551234567", conflict_count: 3 }],
        totalConflicts: 2,
      },
    ]);

    expect(message).toContain("No data was changed");
    expect(message).toContain("tenant_abc.whatsapp_connections");
    expect(message).toContain("one WhatsApp connection per phone number");
    expect(message).toContain("(phone_number)");
    expect(message).toContain("conflicting key groups: 2");
    expect(message).toContain("phone_number=15551234567 (x3)");
  });

  test("reports every blocker, not just the first", () => {
    const message = formatDuplicateBlockers([
      {
        schemaName: "tenant_a",
        table: "whatsapp_connections",
        indexName: "i1",
        columns: ["phone_number"],
        purpose: "p1",
        samples: [],
        totalConflicts: 1,
      },
      {
        schemaName: "tenant_b",
        table: "whatsapp_labels",
        indexName: "i2",
        columns: ["whatsapp_connection_id", "synced_tag_id"],
        purpose: "p2",
        samples: [],
        totalConflicts: 4,
      },
    ]);
    expect(message).toContain("tenant_a.whatsapp_connections");
    expect(message).toContain("tenant_b.whatsapp_labels");
    expect(message).toContain("Cannot create 2 UNIQUE index(es)");
  });
});
