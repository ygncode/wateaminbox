import {
  getContactDisplayName,
  normalizeJid,
  toDbDate,
} from "@wateaminbox/shared";
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
import { broadcastToContactViewers } from "../message-broadcast.service.js";
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

/**
 * What each blocklist command was trying to make `contacts.is_blocked` say.
 *
 * PATCH /contacts/:id writes that column in the same transaction that queues the
 * command, so the indicator turns on before WhatsApp has been asked. When the
 * command then fails, the row is the only thing that ever changed: WhatsApp goes
 * on delivering the contact's messages while the workspace shows them blocked.
 */
const BLOCKLIST_COMMAND_INTENT: Record<string, boolean> = {
  block_contact: true,
  unblock_contact: false,
};

/**
 * Undo that optimistic write once the command is known to have failed.
 *
 * Two conditions, and the second is the one that is easy to miss.
 *
 * The row must still hold the value the failed command wrote, because anything
 * else means a later change already decided what the column says - another
 * toggle, or an inbound blocklist sync - and that decision outranks a rollback
 * for a command that is already over.
 *
 * That is not sufficient on its own: the value is a boolean, so a later change
 * can land on the same value the failed command was aiming for. Block A fails
 * slowly; meanwhile the user unblocks, then blocks again, and block B succeeds.
 * When A's failure finally arrives the column reads `true` for B's reasons, and
 * a check on the value alone would happily clear it - unblocking the contact in
 * this workspace while WhatsApp has them blocked, the same drift in the other
 * direction.
 *
 * So the write is also fenced on time. PATCH /contacts/:id stamps `updated_at`
 * and enqueues the command in one transaction, stamping the outbox row after,
 * which makes `contacts.updated_at <= nats_outbox.created_at` true for exactly
 * the write this command carried and false for every write made after it.
 */
async function rollbackOptimisticBlockState(
  event: CommandResultEvent,
  intended: boolean,
): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const outbox = await tenantDb
    .selectFrom("nats_outbox")
    .select(["payload", "created_at"])
    .where("id", "=", event.payload.commandId)
    .executeTakeFirst();
  const rawContactJid = outbox?.payload.contact_jid;
  const contactJid =
    typeof rawContactJid === "string" ? normalizeJid(rawContactJid) : null;
  // No queued row means no way to tell this command's own write from a later
  // one, and an unfenced revert is worse than none.
  if (!contactJid || !outbox?.created_at) return;

  const reverted = await tenantDb
    .updateTable("contacts")
    .set({ is_blocked: !intended, updated_at: toDbDate() })
    .where("whatsapp_connection_id", "=", event.connectionId)
    .where("jid", "=", contactJid)
    .where("is_blocked", "=", intended)
    .where("updated_at", "<=", outbox.created_at)
    .returning(["id", "jid", "custom_name", "push_name", "phone_number"])
    .execute();

  for (const contact of reverted) {
    await broadcastToContactViewers(
      event.companyId,
      contact.id,
      "contact:updated",
      {
        event: intended ? "unblocked" : "blocked",
        contactId: contact.id,
        contactName: getContactDisplayName(contact, "Unknown Contact"),
        isBlocked: !intended,
      },
    );
  }
}

export async function handleCommandResultEvent(
  event: CommandResultEvent,
): Promise<void> {
  if (event.payload.success) return;
  const blocklistIntent = BLOCKLIST_COMMAND_INTENT[event.payload.commandType];
  // `applied_not_synced` is not a failure: WhatsApp did make the change, only
  // this workspace's view of it is behind. Reverting the column there would
  // undo a change that actually happened.
  if (
    blocklistIntent !== undefined &&
    event.payload.outcome !== "applied_not_synced"
  ) {
    await rollbackOptimisticBlockState(event, blocklistIntent);
  }
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
