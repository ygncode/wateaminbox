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
    "\n=1+1",
  ];

  test.each(payloads)("toCSV makes %j inert", (payload) => {
    // Join everything after the header so an embedded newline in the payload
    // (e.g. a leading "\n") is preserved; split()[1] would silently drop it.
    const cell = toCSV([{ text_content: payload }])
      .split("\n")
      .slice(1)
      .join("\n");

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

  test("a leading line feed is neutralized with the apostrophe inside the quotes", () => {
    // OWASP lists line feed alongside tab and carriage return as a character
    // cells must not begin with. The LF forces quoting, so the apostrophe
    // must land inside the quotes or the formula trigger still escapes.
    expect(escapeCSVCell("\n=1+1")).toBe(`"'\n=1+1"`);
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
