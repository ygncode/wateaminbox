/**
 * Message Batch Routes
 *
 * Routes for batch operations on messages.
 */

import { zValidator } from "@hono/zod-validator";
import { toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { batchDeleteSchema, batchStarSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { requirePermission } from "../../middleware/tenant.js";
import { PERMISSIONS } from "../../services/permission.service.js";

export const batchRoutes = new Hono();

async function canAccessAllMessages(
  c: Parameters<typeof getRouteContext>[0],
  messageIds: string[],
): Promise<boolean> {
  const { tenantDb, user, permissions } = getRouteContext(c);
  if (permissions.can_view_all_chats) return true;
  const visible = await tenantDb
    .selectFrom("messages")
    .innerJoin("contact_assignments", (join) =>
      join
        .onRef("contact_assignments.contact_id", "=", "messages.contact_id")
        .on("contact_assignments.assigned_to", "=", user.id)
        .on("contact_assignments.unassigned_at", "is", null),
    )
    .select("messages.id")
    .where("messages.id", "in", messageIds)
    .execute();
  return visible.length === new Set(messageIds).size;
}

/**
 * POST /star - Star/unstar multiple messages at once
 * Body: { messageIds: string[], star?: boolean (default true) }
 * Limit: 50 messages per request
 */
batchRoutes.post("/star", zValidator("json", batchStarSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const body = c.req.valid("json");
  if (!(await canAccessAllMessages(c, body.messageIds))) {
    return notFound(c, "Message");
  }

  // Update all messages
  const result = await tenantDb
    .updateTable("messages")
    .set({ is_starred: body.star })
    .where("id", "in", body.messageIds)
    .execute();

  return successData(c, {
    updated: Number(result[0]?.numUpdatedRows || 0),
    isStarred: body.star,
  });
});

/**
 * POST /delete - Soft delete multiple messages at once
 * Body: { messageIds: string[] }
 * Limit: 50 messages per request
 */
batchRoutes.post(
  "/delete",
  requirePermission(PERMISSIONS.CAN_DELETE),
  zValidator("json", batchDeleteSchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const body = c.req.valid("json");
    if (!(await canAccessAllMessages(c, body.messageIds))) {
      return notFound(c, "Message");
    }

    // Soft delete all messages
    const result = await tenantDb
      .updateTable("messages")
      .set({ deleted_at: toDbDate() })
      .where("id", "in", body.messageIds)
      .where("deleted_at", "is", null) // Don't re-delete already deleted messages
      .execute();

    return successData(c, {
      deleted: Number(result[0]?.numUpdatedRows || 0),
    });
  },
);
