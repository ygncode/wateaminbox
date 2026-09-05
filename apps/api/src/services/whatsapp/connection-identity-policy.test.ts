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
    expect(handler).toContain("enqueueSessionCommand");
    expect(handler).toContain("publisher.kill(input.commandReason, true)");
    expect(handler).toContain('commandReason: "duplicate phone pairing rejected"');
    expect(handler).toContain('"duplicate_phone"');
    expect(handler).toContain('"identity_mismatch"');
  });

  test("commercial deployments can fail closed through the generic admission hook", async () => {
    const handler = await Bun.file(
      new URL("../handlers/connection-handlers.ts", import.meta.url),
    ).text();
    expect(handler).toContain("admitConnectedPhone");
    expect(handler).toContain('"payment_required"');
    expect(handler).toContain('commandReason: "connection admission rejected"');
  });

  test("an established session reconnect never depends on admission availability", async () => {
    const handler = await Bun.file(
      new URL("../handlers/connection-handlers.ts", import.meta.url),
    ).text();
    const establishedBranch = handler.indexOf("if (establishedReconnect)");
    const admissionCall = handler.indexOf("admission = await admitConnectedPhone");
    expect(establishedBranch).toBeGreaterThan(0);
    expect(admissionCall).toBeGreaterThan(establishedBranch);
    expect(handler).toContain('prior?.session_status === "connected"');
    expect(handler).toContain("transient control-plane");
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

  test("stable inbox identities are separated from replaceable sessions", async () => {
    const migration = await Bun.file(
      new URL(
        "../../../../../packages/database/src/migrations/052_separate_whatsapp_accounts_and_sessions.ts",
        import.meta.url,
      ),
    ).text();
    expect(migration).toContain("whatsapp_connection_sessions");
    expect(migration).toContain("whatsapp_connection_id UUID NOT NULL");
    expect(migration).toContain("WHERE ended_at IS NULL");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS archived_at");
  });
});
