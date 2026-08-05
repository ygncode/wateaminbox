import { describe, expect, test } from "bun:test";
import { app } from "../../app.js";
import {
  MAX_IMPORT_CSV_BYTES,
  MAX_IMPORT_ROWS,
  validateCsvContentInput,
} from "./import.js";

describe("GET /api/contacts/import/template", () => {
  // The CSV template lives behind the workspace auth middleware. The frontend
  // must fetch it with a bearer token; making the route public would be the
  // wrong fix for an unauthenticated download.
  test("rejects requests without an Authorization header", async () => {
    const response = await app.request("/api/contacts/import/template");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      message: "Missing or invalid Authorization header",
    });
  });

  test("rejects a malformed Authorization header", async () => {
    const response = await app.request("/api/contacts/import/template", {
      headers: { Authorization: "NotBearer token" },
    });

    expect(response.status).toBe(401);
  });
});

/**
 * The multipart upload path is bounded by `file.size`. The JSON path had no
 * equivalent ceiling, so a caller could stream an unbounded string straight
 * into memory and into `parseCSV`.
 */
describe("JSON csvContent is validated like an upload", () => {
  test("accepts a normal CSV body", () => {
    const csv = "phone_number,name\n+15551234567,Ada";
    expect(validateCsvContentInput(csv)).toEqual({ ok: true, csvContent: csv });
  });

  test("rejects a body over the upload ceiling", () => {
    const oversized = "a".repeat(MAX_IMPORT_CSV_BYTES + 1);
    expect(validateCsvContentInput(oversized)).toEqual({
      ok: false,
      message: "CSV content must be less than 5MB",
    });
  });

  test("accepts a body exactly at the ceiling", () => {
    expect(validateCsvContentInput("a".repeat(MAX_IMPORT_CSV_BYTES)).ok).toBe(
      true,
    );
  });

  test("measures bytes, not UTF-16 code units", () => {
    // Multi-byte characters must not slip past a length-based check.
    const multiByte = "é".repeat(MAX_IMPORT_CSV_BYTES / 2 + 1);
    expect(multiByte.length).toBeLessThan(MAX_IMPORT_CSV_BYTES);
    expect(validateCsvContentInput(multiByte).ok).toBe(false);
  });

  test("rejects non-string values instead of letting them reach parseCSV", () => {
    // These used to reach parseCSV and surface as a 500, not a 400.
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(validateCsvContentInput(value)).toEqual({
        ok: false,
        message: "csvContent must be a string",
      });
    }
  });

  test("rejects an empty string", () => {
    expect(validateCsvContentInput("")).toEqual({
      ok: false,
      message: "csvContent is required",
    });
  });

  test("the row cap is finite and positive", () => {
    expect(MAX_IMPORT_ROWS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_IMPORT_ROWS)).toBe(true);
  });
});
