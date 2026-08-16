import { normalizeJid, toDbDate } from "@wateaminbox/shared";
import type {
  CatalogProductsEvent,
  CatalogsEvent,
  CommandResultEvent,
  LabelsEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import {
  type CatalogStatus,
  type ProductVisibility,
  syncCatalogProductsFromWhatsApp,
  syncCatalogsFromWhatsApp,
} from "../catalog-sync.service.js";
import { syncLabelsFromWhatsApp } from "../label-sync.service.js";
import { getTenantConnection } from "../tenant.service.js";

export async function handleLabelsEvent(event: LabelsEvent): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const result = await tenantDb
    .transaction()
    .execute((trx) =>
      syncLabelsFromWhatsApp(trx, event.connectionId, event.payload.labels),
    );
  await broadcastToCompany(event.companyId, "labels:updated", { result });
}

export async function handleCatalogsEvent(event: CatalogsEvent): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const catalogs = event.payload.catalogs.map((catalog) => ({
    ...catalog,
    status: catalog.status as CatalogStatus | undefined,
  }));
  const result = await tenantDb
    .transaction()
    .execute((trx) =>
      syncCatalogsFromWhatsApp(trx, event.connectionId, catalogs),
    );
  await broadcastToCompany(event.companyId, "catalogs:updated", { result });
}

/**
 * How a command outcome is surfaced to the user.
 *
 * Driven by the typed `outcome` field rather than by inspecting the error text:
 * an applied-but-unsynced change is not a failure, and calling it one would
 * tell someone to redo work WhatsApp has already done.
 */
function describeCommandOutcome(event: CommandResultEvent): {
  type: "error" | "warning";
  title: string;
} {
  if (event.payload.outcome === "applied_not_synced") {
    return {
      type: "warning",
      title: "WhatsApp change applied, view not up to date",
    };
  }
  return { type: "error", title: "WhatsApp action failed" };
}

export async function handleCommandResultEvent(
  event: CommandResultEvent,
): Promise<void> {
  if (event.payload.success) return;
  if (event.payload.commandType === "request_history") {
    const tenantDb = getTenantConnection(event.companyId);
    const outbox = await tenantDb
      .selectFrom("nats_outbox")
      .select("payload")
      .where("id", "=", event.payload.commandId)
      .executeTakeFirst();
    const rawChatJid = outbox?.payload.chat_jid;
    const chatJid =
      typeof rawChatJid === "string" ? normalizeJid(rawChatJid) : null;
    const contact = chatJid
      ? await tenantDb
          .selectFrom("contacts")
          .select("id")
          .where("whatsapp_connection_id", "=", event.connectionId)
          .where("jid", "=", chatJid)
          .executeTakeFirst()
      : null;
    if (contact) {
      const now = toDbDate();
      await tenantDb
        .updateTable("contacts")
        .set({
          remote_history_status: "failed",
          remote_history_updated_at: now,
          updated_at: now,
        })
        .where("id", "=", contact.id)
        .execute();
      await broadcastToCompany(
        event.companyId,
        "history:loaded",
        {
          conversationId: contact.id,
          messageCount: 0,
          status: "failed",
          error:
            event.payload.error ||
            "The primary phone did not return older messages",
        },
        event.connectionId,
      );
    }
  }
  const outcome = describeCommandOutcome(event);
  await broadcastToCompany(
    event.companyId,
    "command:failed",
    event.payload,
    event.connectionId,
  );
  await broadcastToCompany(
    event.companyId,
    "notification:toast",
    {
      type: outcome.type,
      title: outcome.title,
      message: event.payload.error || `${event.payload.commandType} failed`,
    },
    event.connectionId,
  );
}

export async function handleCatalogProductsEvent(
  event: CatalogProductsEvent,
): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const products = event.payload.products.map((product) => ({
    ...product,
    catalogId: event.payload.catalogId,
    visibility: product.visibility as ProductVisibility | undefined,
  }));
  await tenantDb
    .transaction()
    .execute((trx) =>
      syncCatalogProductsFromWhatsApp(
        trx,
        event.connectionId,
        event.payload.catalogId,
        products,
      ),
    );
  await broadcastToCompany(event.companyId, "catalogs:updated", {
    catalogId: event.payload.catalogId,
  });
}
