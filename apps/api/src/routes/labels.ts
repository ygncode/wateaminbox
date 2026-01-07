import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import {
  getWhatsAppLabels,
  getWhatsAppLabelByLabelId,
  linkTagToLabel,
  unlinkTagFromLabel,
  getTagsWithLabelStatus,
  autoCreateTagsFromLabels,
  getLabelSyncStatus,
} from "../services/label-sync.service.js";
import { getActiveWhatsAppConnection } from "../services/whatsapp-connection.service.js";
import {
  publishSyncLabels,
  publishApplyLabel,
  publishRemoveLabel,
} from "../lib/nats/index.js";
import { isTableNotFoundError, TableNotFoundError } from "../lib/errors.js";

export const labelRoutes = new Hono();

// All label routes require authentication and tenant context
labelRoutes.use("/*", authMiddleware);
labelRoutes.use("/*", tenantMiddleware());

/**
 * GET /labels - List all WhatsApp labels
 */
labelRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);

  try {
    const labels = await getWhatsAppLabels(tenantDb);

    return c.json({
      data: labels,
    });
  } catch (error) {
    // Handle missing table gracefully - return empty array
    if (isTableNotFoundError(error)) {
      return c.json({
        data: [],
      });
    }
    throw error;
  }
});

/**
 * GET /labels/status - Get label sync status summary
 */
labelRoutes.get("/status", async (c) => {
  const { tenantDb } = getRouteContext(c);

  try {
    const status = await getLabelSyncStatus(tenantDb);

    return c.json(status);
  } catch (error) {
    // Handle missing table gracefully - return empty status
    if (isTableNotFoundError(error)) {
      return c.json({
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

  const label = await getWhatsAppLabelByLabelId(tenantDb, labelId);

  if (!label) {
    return c.json({ error: "Label not found" }, 404);
  }

  return c.json(label);
});

/**
 * POST /labels/sync - Trigger a sync of labels from WhatsApp
 * This sends a command to the Go service to fetch labels
 */
labelRoutes.post("/sync", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(tenantDb);

  // Publish sync command to NATS
  await publishSyncLabels(companyId, connection.id, user.id);

  return c.json({
    message: "Label sync initiated. Labels will be updated shortly.",
    status: "syncing",
  });
});

/**
 * POST /labels/:labelId/link - Link a tag to a WhatsApp label
 */
labelRoutes.post("/:labelId/link", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const body = await c.req.json();

  const { tagId } = body;

  if (!tagId) {
    return c.json({ error: "tagId is required" }, 400);
  }

  const result = await linkTagToLabel(tenantDb, tagId, labelId);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true, message: "Tag linked to WhatsApp label" });
});

/**
 * DELETE /labels/:labelId/link - Unlink a tag from a WhatsApp label
 */
labelRoutes.delete("/:labelId/link", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const labelId = c.req.param("labelId");

  // Find the tag linked to this label
  const tag = await tenantDb
    .selectFrom("tags")
    .select(["id"])
    .where("whatsapp_label_id", "=", labelId)
    .executeTakeFirst();

  if (!tag) {
    return c.json({ error: "No tag is linked to this label" }, 400);
  }

  const result = await unlinkTagFromLabel(tenantDb, tag.id);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true, message: "Tag unlinked from WhatsApp label" });
});

/**
 * POST /labels/auto-create - Auto-create tags from unlinked WhatsApp labels
 */
labelRoutes.post("/auto-create", async (c) => {
  const { tenantDb, user } = getRouteContext(c);

  const result = await autoCreateTagsFromLabels(tenantDb, user.id);

  return c.json({
    success: true,
    message: `Created ${result.created} tags and linked ${result.linked} existing tags`,
    created: result.created,
    linked: result.linked,
  });
});

/**
 * GET /labels/tags/with-status - Get all tags with their label sync status
 */
labelRoutes.get("/tags/with-status", async (c) => {
  const { tenantDb } = getRouteContext(c);

  try {
    const tags = await getTagsWithLabelStatus(tenantDb);

    return c.json({
      data: tags,
    });
  } catch (error) {
    // Handle missing table gracefully - return empty array
    if (isTableNotFoundError(error)) {
      return c.json({
        data: [],
      });
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

  // Get the contact's JID
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Contact not found or has no JID" }, 404);
  }

  // Verify the label exists
  const label = await getWhatsAppLabelByLabelId(tenantDb, labelId);

  if (!label) {
    return c.json({ error: "WhatsApp label not found" }, 404);
  }

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(tenantDb);

  // Publish apply label command to NATS
  await publishApplyLabel(
    companyId,
    connection.id,
    labelId,
    contact.jid,
    user.id,
  );

  // If the label is linked to a tag, also add the tag to the contact locally
  if (label.syncedTagId) {
    // Check if contact already has this tag
    const existingTag = await tenantDb
      .selectFrom("contact_tags")
      .select(["contact_id"])
      .where("contact_id", "=", contactId)
      .where("tag_id", "=", label.syncedTagId)
      .executeTakeFirst();

    if (!existingTag) {
      await tenantDb
        .insertInto("contact_tags")
        .values({
          contact_id: contactId,
          tag_id: label.syncedTagId,
        })
        .execute();
    }
  }

  return c.json({
    success: true,
    message: "Label applied to contact",
  });
});

/**
 * DELETE /labels/:labelId/apply/:contactId - Remove a WhatsApp label from a contact
 * This syncs the removal to WhatsApp
 */
labelRoutes.delete("/:labelId/apply/:contactId", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const labelId = c.req.param("labelId");
  const contactId = c.req.param("contactId");

  // Get the contact's JID
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Contact not found or has no JID" }, 404);
  }

  // Verify the label exists
  const label = await getWhatsAppLabelByLabelId(tenantDb, labelId);

  if (!label) {
    return c.json({ error: "WhatsApp label not found" }, 404);
  }

  // Check if WhatsApp is connected (throws ServiceUnavailableError if not)
  const connection = await getActiveWhatsAppConnection(tenantDb);

  // Publish remove label command to NATS
  await publishRemoveLabel(
    companyId,
    connection.id,
    labelId,
    contact.jid,
    user.id,
  );

  // If the label is linked to a tag, also remove the tag from the contact locally
  if (label.syncedTagId) {
    await tenantDb
      .deleteFrom("contact_tags")
      .where("contact_id", "=", contactId)
      .where("tag_id", "=", label.syncedTagId)
      .execute();
  }

  return c.json({
    success: true,
    message: "Label removed from contact",
  });
});
