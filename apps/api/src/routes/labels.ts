import { Hono } from "hono";
import { isTableNotFoundError, badRequest, notFound } from "../lib/errors.js";
import { enqueueConnectionCommand } from "../services/command-outbox.service.js";
import {
  successData,
  successMessage,
  successPaginated,
  successWithMessage,
} from "../lib/response.js";
import {
  createPaginationMeta,
  extractPaginationParams,
} from "../lib/route-helpers.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import {
  autoCreateTagsFromLabels,
  getLabelSyncStatus,
  getTagsWithLabelStatus,
  getWhatsAppLabelByLabelId,
  getWhatsAppLabels,
  getWhatsAppLabelsCount,
  linkTagToLabel,
  unlinkTagFromLabel,
} from "../services/label-sync.service.js";
import { PERMISSIONS } from "../services/permission.service.js";
import {
  getActiveWhatsAppConnection,
  getWhatsAppConnection,
} from "../services/whatsapp-connection.service.js";

export const labelRoutes = new Hono();

// All label routes require authentication and tenant context
labelRoutes.use("/*", authMiddleware);
labelRoutes.use("/*", tenantMiddleware());
labelRoutes.use("/*", requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS));

/**
 * GET /labels - List all WhatsApp labels with optional pagination
 * Query params: limit (default 50), offset (default 0)
 */
labelRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const { limit, offset } = extractPaginationParams(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  try {
    // Get total count
    const total = await getWhatsAppLabelsCount(tenantDb, connection.id);

    // Get paginated labels
    const labels = await getWhatsAppLabels(tenantDb, connection.id, {
      limit,
      offset,
    });

    return successPaginated(
      c,
      labels,
      createPaginationMeta(total, labels.length, { limit, offset }),
    );
  } catch (error) {
    // Handle missing table gracefully - return empty array
    if (isTableNotFoundError(error)) {
      return successPaginated(
        c,
        [],
        createPaginationMeta(0, 0, { limit, offset }),
      );
    }
    throw error;
  }
});

/**
 * GET /labels/status - Get label sync status summary
 */
labelRoutes.get("/status", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  try {
    const status = await getLabelSyncStatus(tenantDb, connection.id);

    return successData(c, status);
  } catch (error) {
    // Handle missing table gracefully - return empty status
    if (isTableNotFoundError(error)) {
      return successData(c, {
        totalLabels: 0,
        linkedLabels: 0,
        unlinkedLabels: 0,
        totalTags: 0,
        linkedTags: 0,
        lastSyncAt: null,
      });
    }
    throw error;
  }
});

/**
 * GET /labels/:labelId - Get a specific WhatsApp label
 */
labelRoutes.get("/:labelId", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  const label = await getWhatsAppLabelByLabelId(
    tenantDb,
    labelId,
    connection.id,
  );

  if (!label) {
    return notFound(c, "Label");
  }

  return successData(c, label);
});

/**
 * POST /labels/sync - Trigger a sync of labels from WhatsApp
 * This sends a command to the Go service to fetch labels
 */
labelRoutes.post("/sync", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  await tenantDb
    .transaction()
    .execute((trx) =>
      enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
        publisher.syncLabels(user.id),
      ),
    );

  return successWithMessage(
    c,
    "Label sync initiated. Labels will be updated shortly.",
    { status: "syncing" },
  );
});

/**
 * POST /labels/:labelId/link - Link a tag to a WhatsApp label
 */
labelRoutes.post("/:labelId/link", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );
  const body = await c.req.json();

  const { tagId } = body;

  if (!tagId) {
    return badRequest(c, "tagId is required");
  }

  const result = await linkTagToLabel(tenantDb, connection.id, tagId, labelId);

  if (!result.success) {
    return badRequest(c, result.error || "Failed to link tag to label");
  }

  return successMessage(c, "Tag linked to WhatsApp label");
});

/**
 * DELETE /labels/:labelId/link - Unlink a tag from a WhatsApp label
 */
labelRoutes.delete("/:labelId/link", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );
  const result = await unlinkTagFromLabel(tenantDb, connection.id, labelId);

  if (!result.success) {
    return badRequest(c, result.error || "Failed to unlink tag from label");
  }

  return successMessage(c, "Tag unlinked from WhatsApp label");
});

/**
 * POST /labels/auto-create - Auto-create tags from unlinked WhatsApp labels
 */
labelRoutes.post("/auto-create", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  const result = await autoCreateTagsFromLabels(
    tenantDb,
    connection.id,
    user.id,
  );

  return successWithMessage(
    c,
    `Created ${result.created} tags and linked ${result.linked} existing tags`,
    { created: result.created, linked: result.linked },
  );
});

/**
 * GET /labels/tags/with-status - Get all tags with their label sync status
 */
labelRoutes.get("/tags/with-status", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const connection = await getWhatsAppConnection(
    tenantDb,
    c.req.query("connectionId"),
  );

  try {
    const tags = await getTagsWithLabelStatus(tenantDb, connection.id);

    return successData(c, tags);
  } catch (error) {
    // Handle missing table gracefully - return empty array
    if (isTableNotFoundError(error)) {
      return successData(c, []);
    }
    throw error;
  }
});

/**
 * POST /labels/:labelId/apply/:contactId - Apply a WhatsApp label to a contact
 * This syncs the label to WhatsApp
 */
labelRoutes.post("/:labelId/apply/:contactId", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const contactId = c.req.param("contactId");

  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact?.jid) return notFound(c, "Contact");
  if (!contact.whatsapp_connection_id) {
    return badRequest(
      c,
      "Contact is not associated with a WhatsApp connection",
    );
  }

  const label = await getWhatsAppLabelByLabelId(
    tenantDb,
    labelId,
    contact.whatsapp_connection_id,
  );
  if (!label) return notFound(c, "WhatsApp label");

  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select("id")
    .where("id", "=", contact.whatsapp_connection_id)
    .where("status", "=", "connected")
    .executeTakeFirst();
  if (!connection) return badRequest(c, "Contact's connection is not active");

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
      publisher.applyLabel(labelId, contact.jid!, user.id),
    );
    if (label.syncedTagId) {
      await trx
        .insertInto("contact_tags")
        .values({ contact_id: contactId, tag_id: label.syncedTagId })
        .onConflict((conflict) =>
          conflict.columns(["contact_id", "tag_id"]).doNothing(),
        )
        .execute();
    }
  });

  return successMessage(c, "Label applied to contact");
});

/**
 * DELETE /labels/:labelId/apply/:contactId - Remove a WhatsApp label from a contact
 * This syncs the removal to WhatsApp
 */
labelRoutes.delete("/:labelId/apply/:contactId", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const contactId = c.req.param("contactId");

  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact?.jid) return notFound(c, "Contact");
  if (!contact.whatsapp_connection_id) {
    return badRequest(
      c,
      "Contact is not associated with a WhatsApp connection",
    );
  }

  const label = await getWhatsAppLabelByLabelId(
    tenantDb,
    labelId,
    contact.whatsapp_connection_id,
  );
  if (!label) return notFound(c, "WhatsApp label");

  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select("id")
    .where("id", "=", contact.whatsapp_connection_id)
    .where("status", "=", "connected")
    .executeTakeFirst();
  if (!connection) return badRequest(c, "Contact's connection is not active");

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(trx, companyId, connection.id, (publisher) =>
      publisher.removeLabel(labelId, contact.jid!, user.id),
    );
    if (label.syncedTagId) {
      await trx
        .deleteFrom("contact_tags")
        .where("contact_id", "=", contactId)
        .where("tag_id", "=", label.syncedTagId)
        .execute();
    }
  });

  return successMessage(c, "Label removed from contact");
});
