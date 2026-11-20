import type { TenantDatabase } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import type { Transaction } from "kysely";
import { z } from "zod";
import {
  activeSuppressions,
  applySuppression,
  contactMergeGroup,
  isSuppressionEnforced,
  revokeSuppression,
  SuppressionTargetError,
} from "../../channel-spine/application/contact-policy.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { zValidator } from "../../lib/validator.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { resolveWorkflowContactId } from "../../services/channel-workflow.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import { broadcastToContactViewers } from "../../services/message-broadcast.service.js";

/**
 * Customer suppression (contact blocking) for every channel.
 *
 * `PATCH /contacts/:id { isBlocked }` remains the WhatsApp blocklist toggle and
 * still dual-writes `block`. These routes are the channel-neutral surface:
 * they work for a Telegram-only customer, add `mute_inbound`, and report the
 * status per channel so a partial state (blocked here, provider not told) is
 * visible instead of hidden.
 */
export const suppressionRoutes = new Hono();

const scopeSchema = z.enum(["block", "mute_inbound"]);

const applySchema = z.object({
  scope: scopeSchema,
  /** Mute for a while; omitted means until lifted. At most 30 days. */
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 30)
    .optional(),
});

async function resolveCustomer(
  c: Parameters<typeof getRouteContext>[0],
): Promise<string | null> {
  const { tenantDb } = getRouteContext(c);
  const requested = c.req.param("id")!;
  const contactId =
    (await resolveWorkflowContactId(tenantDb, requested)) ?? requested;
  const group = await contactMergeGroup(tenantDb, contactId);
  return group[0] ?? null;
}

/**
 * Best-effort mirror of a customer block onto every connected WhatsApp half
 * of the merge group: WhatsApp can enforce it on the phone too. Uses the same
 * optimistic `is_blocked` write and `block_contact` command as
 * `PATCH /contacts/:id`, so the existing failure rollback applies. A half
 * whose connection is offline is skipped; the workspace block still holds.
 */
async function mirrorWhatsAppBlocklist(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  customerId: string,
  blocked: boolean,
): Promise<number> {
  const group = await contactMergeGroup(trx, customerId);
  const halves = await trx
    .selectFrom("contacts")
    .innerJoin(
      "whatsapp_connections",
      "whatsapp_connections.id",
      "contacts.whatsapp_connection_id",
    )
    .select([
      "contacts.id",
      "contacts.jid",
      "whatsapp_connections.id as connection_id",
    ])
    .where("contacts.id", "in", group)
    .where("contacts.is_group", "=", false)
    .where("contacts.jid", "is not", null)
    .where("contacts.is_blocked", "=", !blocked)
    .where("whatsapp_connections.status", "=", "connected")
    .execute();
  for (const half of halves) {
    await trx
      .updateTable("contacts")
      .set({ is_blocked: blocked, updated_at: toDbDate() })
      .where("id", "=", half.id)
      .execute();
    await enqueueConnectionCommand(
      trx,
      companyId,
      half.connection_id,
      (publisher) =>
        blocked
          ? publisher.blockContact(half.jid!)
          : publisher.unblockContact(half.jid!),
    );
  }
  return halves.length;
}

/** GET /contacts/:id/suppressions - current status, per channel. */
suppressionRoutes.get(
  "/:id/suppressions",
  requireContactVisibility(),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const customerId = await resolveCustomer(c);
    if (!customerId) return notFound(c, "Contact");
    const group = await contactMergeGroup(tenantDb, customerId);

    const [suppressions, enforced, channels, drops] = await Promise.all([
      activeSuppressions(tenantDb, customerId),
      isSuppressionEnforced(tenantDb),
      tenantDb
        .selectFrom("contact_endpoints as endpoint")
        .leftJoin("endpoint_account_states as state", (join) =>
          join
            .onRef("state.contact_endpoint_id", "=", "endpoint.id")
            .onRef(
              "state.channel_account_id",
              "=",
              "endpoint.channel_account_id",
            ),
        )
        .select([
          "endpoint.channel",
          "endpoint.provider",
          "state.provider_block_state",
          "state.provider_status",
        ])
        .where("endpoint.contact_id", "in", group)
        .execute(),
      tenantDb
        .selectFrom("contact_suppression_drops")
        .select((eb) => [
          "channel",
          eb.fn.sum<string>("dropped_count").as("dropped"),
          eb.fn.max("last_dropped_at").as("last_dropped_at"),
        ])
        .where("contact_id", "in", group)
        .groupBy("channel")
        .execute(),
    ]);
    const legacy = await tenantDb
      .selectFrom("contacts")
      .select(["is_blocked", "whatsapp_connection_id"])
      .where("id", "in", group)
      .execute();

    const byChannel = new Map<
      string,
      {
        channel: string;
        providerBlocked: boolean;
        unreachable: boolean;
        dropped: number;
        lastDroppedAt: Date | null;
      }
    >();
    for (const row of channels) {
      const entry = byChannel.get(row.channel) ?? {
        channel: row.channel,
        providerBlocked: false,
        unreachable: false,
        dropped: 0,
        lastDroppedAt: null,
      };
      entry.providerBlocked ||= row.provider_block_state === "blocked";
      entry.unreachable ||= row.provider_status === "unreachable";
      byChannel.set(row.channel, entry);
    }
    // A WhatsApp contact has no neutral endpoint until the spine mirrors it; its
    // blocklist mirror is the legacy column.
    if (legacy.some((row) => row.whatsapp_connection_id)) {
      const entry = byChannel.get("whatsapp") ?? {
        channel: "whatsapp",
        providerBlocked: false,
        unreachable: false,
        dropped: 0,
        lastDroppedAt: null,
      };
      entry.providerBlocked ||= legacy.some((row) => row.is_blocked);
      byChannel.set("whatsapp", entry);
    }
    for (const row of drops) {
      const entry = byChannel.get(row.channel);
      if (!entry) continue;
      entry.dropped = Number(row.dropped ?? 0);
      entry.lastDroppedAt = row.last_dropped_at
        ? new Date(row.last_dropped_at)
        : null;
    }

    return successData(c, {
      contactId: customerId,
      enforced,
      blocked: suppressions.some((row) => row.scope === "block"),
      muted: suppressions.find((row) => row.scope === "mute_inbound") ?? null,
      suppressions: suppressions.map((row) => ({
        id: row.id,
        scope: row.scope,
        reason: row.reason,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      })),
      channels: [...byChannel.values()].sort((a, b) =>
        a.channel.localeCompare(b.channel),
      ),
    });
  },
);

/** POST /contacts/:id/suppressions - block or mute a customer on every channel. */
suppressionRoutes.post(
  "/:id/suppressions",
  requireContactVisibility(),
  requireMessageSendPermission,
  zValidator("json", applySchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const { scope, durationMinutes } = c.req.valid("json");
    const customerId = await resolveCustomer(c);
    if (!customerId) return notFound(c, "Contact");
    const expiresAt =
      scope === "mute_inbound" && durationMinutes
        ? new Date(Date.now() + durationMinutes * 60_000)
        : null;
    let result: { suppressionId: string; created: boolean };
    try {
      result = await tenantDb.transaction().execute(async (trx) => {
        const applied = await applySuppression(trx, {
          contactId: customerId,
          scope,
          reason: "manual",
          actorUserId: user.id,
          expiresAt,
        });
        if (scope === "block" && applied.created) {
          await mirrorWhatsAppBlocklist(trx, companyId, customerId, true);
        }
        return applied;
      });
    } catch (error) {
      if (error instanceof SuppressionTargetError) {
        return badRequest(c, error.message);
      }
      throw error;
    }
    if (result.created) {
      await createAuditLog({
        companyId,
        userId: user.id,
        action: scope === "block" ? "contact.blocked" : "contact.muted",
        entityType: "contact",
        entityId: customerId,
        details: { scope, channels: "all", expiresAt },
        ipAddress: getClientIp(c),
      });
      await broadcastToContactViewers(
        companyId,
        customerId,
        "contact:updated",
        {
          event: scope === "block" ? "blocked" : "muted",
          contactId: customerId,
        },
      );
    }
    return successData(c, { ...result, scope, expiresAt });
  },
);

/** DELETE /contacts/:id/suppressions/:scope - lift a block or mute everywhere. */
suppressionRoutes.delete(
  "/:id/suppressions/:scope",
  requireContactVisibility(),
  requireMessageSendPermission,
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const scope = scopeSchema.safeParse(c.req.param("scope"));
    if (!scope.success) return badRequest(c, "Unknown suppression scope");
    const customerId = await resolveCustomer(c);
    if (!customerId) return notFound(c, "Contact");
    const revoked = await tenantDb.transaction().execute(async (trx) => {
      const count = await revokeSuppression(trx, {
        contactId: customerId,
        scope: scope.data,
        actorUserId: user.id,
      });
      // Also lift a WhatsApp-only block (set on the phone or before
      // suppressions existed), which has no suppression row to revoke.
      if (scope.data === "block") {
        const lifted = await mirrorWhatsAppBlocklist(
          trx,
          companyId,
          customerId,
          false,
        );
        return count + lifted;
      }
      return count;
    });
    if (revoked > 0) {
      await createAuditLog({
        companyId,
        userId: user.id,
        action:
          scope.data === "block" ? "contact.unblocked" : "contact.unmuted",
        entityType: "contact",
        entityId: customerId,
        details: { scope: scope.data, revoked },
        ipAddress: getClientIp(c),
      });
      await broadcastToContactViewers(
        companyId,
        customerId,
        "contact:updated",
        {
          event: scope.data === "block" ? "unblocked" : "unmuted",
          contactId: customerId,
        },
      );
    }
    return successData(c, { revoked });
  },
);
