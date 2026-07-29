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

describe("multi-connection business data", () => {
  test("label and catalog settings enforce connection-management permission", () => {
    for (const route of [
      read("../routes/labels.ts"),
      read("../routes/catalogs.ts"),
    ]) {
      expect(route).toContain(
        "requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS)",
      );
    }
  });

  test("labels, catalogs, and products are keyed by connection", () => {
    const migration = read(
      "../../../../packages/database/src/migrations/054_scope_business_data_to_connections.ts",
    );
    expect(migration).toContain("(whatsapp_connection_id, label_id)");
    expect(migration).toContain("(whatsapp_connection_id, catalog_id)");
    expect(migration).toContain(
      "whatsapp_connection_id, catalog_id, product_id",
    );
  });

  test("worker sync handlers retain the resolved connection ID", () => {
    const handlers = read("./handlers/business-handlers.ts");
    expect(handlers).toContain(
      "syncLabelsFromWhatsApp(trx, event.connectionId",
    );
    expect(handlers).toContain(
      "syncCatalogsFromWhatsApp(trx, event.connectionId",
    );
    expect(handlers).toContain(
      "syncCatalogProductsFromWhatsApp(\n        trx,\n        event.connectionId",
    );
  });

  test("catalog sync does not overwrite a local archive without remote status", () => {
    const service = read("./catalog-sync.service.ts");
    const updateSection = service.slice(
      service.indexOf("update: async (catalog)"),
      service.indexOf("remove: async (catalog)"),
    );
    expect(updateSection).toContain(
      "...(catalog.status ? { status: catalog.status } : {})",
    );
    expect(updateSection).not.toContain(
      'status: catalog.status ?? "active",\n            business_jid',
    );
  });
});
