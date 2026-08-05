import { describe, expect, test } from "bun:test";
import { createCSVHeader, createCSVRow, escapeCSVCell, toCSV } from "./csv.js";

const QUOTED_FORMULA_PREFIX = `"'`;

/**
 * Exported rows carry content that arrives from outside the tenant (WhatsApp
 * message bodies, push names). A cell a spreadsheet reads as a formula is
 * therefore code execution against whoever opens the export.
 */
describe("CSV export neutralizes spreadsheet formula injection", () => {
  const payloads = [
    "=cmd|'/c calc'!A1",
    "+1+1",
    "-2+3",
    "@SUM(1:99)",
    "\t=1+1",
    "\r=1+1",
  ];

  test.each(payloads)("toCSV makes %j inert", (payload) => {
    const cell = toCSV([{ text_content: payload }]).split("\n")[1];

    expect(cell.startsWith("'") || cell.startsWith(QUOTED_FORMULA_PREFIX)).toBe(
      true,
    );
    expect(cell).toContain(payload);
  });

  test.each(payloads)("escapeCSVCell makes %j inert", (payload) => {
    const cell = escapeCSVCell(payload);
    expect(cell.startsWith("'") || cell.startsWith(QUOTED_FORMULA_PREFIX)).toBe(
      true,
    );
  });

  test("createCSVRow neutralizes every column, not just the first", () => {
    const row = createCSVRow({ a: "safe", b: "=1+1", c: "@evil()" }, [
      "a",
      "b",
      "c",
    ]);
    expect(row).toBe("safe,'=1+1,'@evil()");
  });

  test("createCSVHeader neutralizes attacker-influenced column names", () => {
    expect(createCSVHeader(["name", "=1+1"])).toBe("name,'=1+1");
  });

  test("a formula that also needs quoting is quoted AND neutralized", () => {
    // The apostrophe must land inside the quotes; otherwise the quoting is
    // broken and the formula escapes anyway.
    expect(escapeCSVCell('=HYPERLINK("http://evil","x"),y')).toBe(
      `"'=HYPERLINK(""http://evil"",""x""),y"`,
    );
  });
});

describe("CSV export escaping is otherwise unchanged", () => {
  test("ordinary values pass through untouched", () => {
    expect(toCSV([{ name: "Ada Lovelace", city: "London" }])).toBe(
      "name,city\nAda Lovelace,London",
    );
    expect(escapeCSVCell("hello world")).toBe("hello world");
    expect(escapeCSVCell(42)).toBe("42");
    expect(escapeCSVCell(null)).toBe("");
    expect(escapeCSVCell(undefined)).toBe("");
  });

  test("delimiter, quote, and newline escaping still round-trips", () => {
    expect(escapeCSVCell("a,b")).toBe('"a,b"');
    expect(escapeCSVCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCSVCell("line1\nline2")).toBe('"line1\nline2"');
  });

  test("an embedded CR is quoted so it cannot split a record", () => {
    expect(escapeCSVCell("line1\rline2")).toBe('"line1\rline2"');
  });

  test("empty input still produces an empty document", () => {
    expect(toCSV([])).toBe("");
  });
});
