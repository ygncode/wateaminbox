import { describe, expect, test } from "bun:test";
import type { TenantDatabase } from "@wateaminbox/database";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type SqlBool,
  sql,
} from "kysely";
import {
  buildContactWhereClause,
  buildSearchClause,
  phoneSearchDigits,
} from "./contact-query-builder.js";

// Compile-only handle: the real service runs this clause inside its own raw
// SQL, and this keeps the assertions offline (no pool, no DATABASE_URL).
const compiler = new Kysely<TenantDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function compiledSearch(search: string) {
  return compiler
    .selectFrom("contacts")
    .select("id")
    .where(sql<SqlBool>`${buildSearchClause(search)}`)
    .compile();
}

describe("phoneSearchDigits", () => {
  test("restates a formatted number as the digits the column stores", () => {
    expect(phoneSearchDigits("+91 79810 75978")).toBe("917981075978");
    expect(phoneSearchDigits("(+91) 7981-075978")).toBe("917981075978");
  });

  test("leaves a digits-only search to the ILIKE that already covers it", () => {
    expect(phoneSearchDigits("917981075978")).toBeNull();
    expect(phoneSearchDigits(" 917981075978 ")).toBeNull();
  });

  test("ignores searches carrying no usable number", () => {
    expect(phoneSearchDigits("Software")).toBeNull();
    expect(phoneSearchDigits("+9")).toBeNull();
    expect(phoneSearchDigits("12")).toBeNull();
    expect(phoneSearchDigits(undefined)).toBeNull();
  });
});

describe("buildSearchClause", () => {
  test("matches a formatted number against the stored digits as well", () => {
    const { parameters } = compiledSearch("+91 79810 75978");
    expect(parameters).toContain("%+91 79810 75978%");
    expect(parameters).toContain("%917981075978%");
  });

  test("does not widen a digits-only search", () => {
    const { parameters } = compiledSearch("917981075978");
    expect(parameters).toEqual([
      "%917981075978%",
      "%917981075978%",
      "%917981075978%",
      "%917981075978%",
    ]);
  });

  test("adds a second phone pattern only for a formatted number", () => {
    const formatted = compiledSearch("+91 79810 75978").sql;
    const digitsOnly = compiledSearch("917981075978").sql;
    expect(formatted.match(/phone_number ILIKE/g)?.length).toBe(2);
    expect(digitsOnly.match(/phone_number ILIKE/g)?.length).toBe(1);
  });

  test("keeps a name search on the identity columns", () => {
    const { sql: text, parameters } = compiledSearch("Software");
    expect(text).toContain("push_name ILIKE");
    expect(text).toContain("custom_name ILIKE");
    expect(parameters).toEqual([
      "%Software%",
      "%Software%",
      "%Software%",
      "%Software%",
    ]);
  });
});

function compiledWhere(
  options: Parameters<typeof buildContactWhereClause>[0],
): string {
  const { whereClause } = buildContactWhereClause(options);
  return compiler
    .selectFrom("contacts")
    .select("id")
    .where(sql<SqlBool>`${whereClause}`)
    .compile().sql;
}

const tenantTable = (name: string) => sql.table(`tenant_x.${name}`);

describe("buildContactWhereClause merge collapse", () => {
  test("hides contacts that were merged into another customer", () => {
    // A merged customer is one inbox row. The merged-away contact keeps its
    // conversation, which stays reachable through the chat switcher.
    expect(compiledWhere({})).toContain(
      "c.merged_into_contact_id IS NULL",
    );
  });

  test("keeps an assigned chat in its assignee's filter after a merge", () => {
    // The assignment may sit on the merged-away row, whose own entry is now
    // hidden. Answering from the surviving row alone would drop the chat out
    // of "assigned to me" entirely.
    const withGroup = compiledWhere({
      assignedToMe: true,
      userId: "user-1",
      contactsTable: tenantTable("contacts"),
      contactAssignmentsTable: tenantTable("contact_assignments"),
    });
    expect(withGroup).toContain("EXISTS");
    expect(withGroup).toContain("mc.merged_into_contact_id = c.id");
  });

  test("treats unassigned as nobody in the group holding it", () => {
    const unassigned = compiledWhere({
      unassigned: true,
      contactsTable: tenantTable("contacts"),
      contactAssignmentsTable: tenantTable("contact_assignments"),
    });
    expect(unassigned).toContain("ca.assigned_to IS NULL");
    expect(unassigned).toContain("NOT EXISTS");
  });

  test("counts unread on a merged-away thread toward the surviving row", () => {
    expect(compiledWhere({ unreadOnly: true })).toContain(
      "grp.unread_count",
    );
  });

  test("omits the group term when the caller passes no tenant tables", () => {
    // The helper is also used by callers that compile the clause without a
    // schema to qualify; those must not emit a half-built subquery.
    const withoutTables = compiledWhere({ assignedToMe: true, userId: "u" });
    expect(withoutTables).not.toContain("merged_into_contact_id = c.id");
    expect(withoutTables).toContain("FALSE");
  });
});
