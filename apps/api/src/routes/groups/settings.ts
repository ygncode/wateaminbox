/**
 * Group Settings Routes
 *
 * Routes for updating group settings and checking admin status.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { notFound, badRequest, forbidden } from "../../lib/errors.js";
import { publishGroupUpdateSettings } from "../../lib/nats/index.js";
import { successData, successWithMessage } from "../../lib/response.js";
import { updateGroupSettingsSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { getConnectionJid, isUserGroupAdmin } from "./helpers.js";

export const settingsRoutes = new Hono();

/**
 * PATCH /:id/settings - Update group settings (name, description)
 */
settingsRoutes.patch(
  "/:id/settings",
  zValidator("json", updateGroupSettingsSchema),
  async (c) => {
    const { tenantDb, companyId, user } = getRouteContext(c);
    const userId = user.id;
    const contactId = c.req.param("id");
    const { name, description } = c.req.valid("json");

    // Validate input - at least one field must be provided
    if (!name && description === undefined) {
      return badRequest(c, "At least one of name or description is required");
    }

    // Get group contact
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", contactId)
      .where("is_group", "=", true)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Group");
    }

    if (!contact.whatsapp_connection_id) {
      return badRequest(
        c,
        "Group is not associated with any WhatsApp connection",
      );
    }

    // Get group details
    const group = await tenantDb
      .selectFrom("groups")
      .select(["id", "name", "description"])
      .where("contact_id", "=", contactId)
      .executeTakeFirst();

    if (!group) {
      return notFound(c, "Group details");
    }

    // Check if current user is admin
    const connectionJid = await getConnectionJid(tenantDb);
    const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

    if (!isAdmin) {
      return forbidden(c, "Only group admins can update group settings");
    }

    // Build update object
    const updates: { name?: string; description?: string } = {};
    if (name !== undefined) {
      updates.name = name;
    }
    if (description !== undefined) {
      updates.description = description;
    }

    // Update local database
    if (Object.keys(updates).length > 0) {
      await tenantDb
        .updateTable("groups")
        .set(updates)
        .where("id", "=", group.id)
        .execute();
    }

    // Publish NATS command to WhatsApp service
    await publishGroupUpdateSettings(
      companyId,
      contact.whatsapp_connection_id,
      contact.jid,
      userId,
      name,
      description,
    );

    // Create audit log
    await createAuditLog({
      companyId,
      userId,
      action: "contact.updated",
      entityType: "group",
      entityId: contactId,
      details: {
        groupJid: contact.jid,
        previousName: group.name,
        previousDescription: group.description,
        newName: name,
        newDescription: description,
        operation: "update_settings",
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });

    return successWithMessage(c, "Group settings updated", {
      name: name ?? group.name,
      description: description ?? group.description,
    });
  },
);

/**
 * GET /:id/admin-status - Check if current user is admin of this group
 */
settingsRoutes.get("/:id/admin-status", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Check if group exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", contactId)
    .where("is_group", "=", true)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Group");
  }

  // Get connection JID
  const connectionJid = await getConnectionJid(tenantDb);

  if (!connectionJid) {
    return successData(c, {
      isAdmin: false,
      connectionJid: null,
      reason: "No active WhatsApp connection",
    });
  }

  // Check admin status
  const isAdmin = await isUserGroupAdmin(tenantDb, contactId, connectionJid);

  return successData(c, {
    isAdmin,
    connectionJid,
  });
});
