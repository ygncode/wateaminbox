/**
 * Message Batch Routes
 *
 * Routes for batch operations on messages.
 */
import { toDbDate } from "@whatsapp-web/shared";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { successData } from "../../lib/response.js";
import { batchStarSchema, batchDeleteSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";

export const batchRoutes = new Hono();

/**
 * POST /star - Star/unstar multiple messages at once
 * Body: { messageIds: string[], star?: boolean (default true) }
 * Limit: 50 messages per request
 */
batchRoutes.post("/star", zValidator("json", batchStarSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const body = c.req.valid("json");

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
  zValidator("json", batchDeleteSchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const body = c.req.valid("json");

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
