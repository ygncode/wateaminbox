import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("multi-connection message identity", () => {
  test("all inbound mutation handlers pair WhatsApp IDs with connection IDs", () => {
    const messageHandlers = read("./handlers/message-handlers.ts");
    const reactionHandlers = read("./handlers/reaction-handlers.ts");

    for (const marker of [
      "handleReceiptEvent",
      "handleSendConfirmationEvent",
      "handleSendFailedEvent",
    ]) {
      const section = messageHandlers.slice(messageHandlers.indexOf(marker));
      expect(section.slice(0, 8_000), marker).toContain(
        '.where("whatsapp_connection_id", "=", connectionId)',
      );
    }
    expect(reactionHandlers).toContain(
      '.where("whatsapp_connection_id", "=", connectionId)',
    );
  });

  test("database deduplication allows the same remote ID on two connections", () => {
    const migration = read(
      "../../../../packages/database/src/migrations/027_add_message_deduplication_constraint.ts",
    );
    expect(migration).toContain("UNIQUE (whatsapp_connection_id, message_id)");
    expect(migration).not.toContain("UNIQUE (message_id)");
  });
});
