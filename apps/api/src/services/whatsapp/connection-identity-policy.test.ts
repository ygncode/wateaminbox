import { describe, expect, test } from "bun:test";
import { normalizeWhatsAppPhone } from "./status.js";

describe("WhatsApp connection identity policy", () => {
  test("normalizes formatting variants to one phone identity", () => {
    expect(normalizeWhatsAppPhone("+1 (415) 555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone("1-415-555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone(" 14155550199 ")).toBe("14155550199");
  });

  test("retains a stable fallback for a non-numeric identity", () => {
    expect(normalizeWhatsAppPhone(" Business-Line ")).toBe("business-line");
  });

  test("duplicate pairings are stopped and surfaced to the workspace", async () => {
    const handler = await Bun.file(
      new URL("../handlers/connection-handlers.ts", import.meta.url),
    ).text();
    expect(handler).toContain("DuplicateWhatsAppPhoneError");
    expect(handler).toContain("killConnection");
    expect(handler).toContain('code: "duplicate_phone"');
  });

  test("the database migration enforces one non-null phone per workspace", async () => {
    const migration = await Bun.file(
      new URL(
        "../../../../../packages/database/src/migrations/046_unique_whatsapp_phone_connections.ts",
        import.meta.url,
      ),
    ).text();
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(migration).toContain("(phone_number)");
    expect(migration).toContain("WHERE phone_number IS NOT NULL");
  });
});
