/**
 * Contact Routes Index
 *
 * Consolidates all contact-related routes into a single module:
 * - /contacts - Main CRUD operations
 * - /contacts/:id/notes/* - Notes (shared & private)
 * - /contacts/:id/tags - Tag management
 * - /contacts/:id/assign - Assignment management
 * - /contacts/import/* - CSV import
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@wateaminbox/database";
import {
  toDbDate,
  getContactDisplayName,
  getContactName,
  extractPhoneFromJid,
  getUserDisplayName,
} from "@wateaminbox/shared";
import { authMiddleware } from "../../middleware/auth.js";
import { notFound, badRequest, serverError } from "../../lib/errors.js";
import { successData, successPaginated, created } from "../../lib/response.js";
import { createPaginationMeta } from "../../lib/route-helpers.js";
import {
  transformContacts,
  type RawContactFromDb,
} from "../../lib/data-transformers.js";
import { normalizePhoneNumber } from "../../lib/schemas.js";
import {
  createContactSchema,
  updateContactSchema,
  listContactsQuerySchema,
} from "../../lib/schemas/index.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { getRouteContext } from "../../middleware/context.js";
import { getContactsWithLastMessage } from "../../services/contact.service.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { broadcastToCompany } from "../../lib/pusher.js";
import {
  publishBlockContact,
  publishUnblockContact,
} from "../../lib/nats/client.js";

// Import sub-routes
import { notesRoutes } from "./notes.js";
import { tagsRoutes } from "./tags.js";
import { assignmentRoutes } from "./assignment.js";
import { importRoutes } from "./import.js";

export const contactRoutes = new Hono();

// All contact routes require authentication and tenant context
contactRoutes.use("/*", authMiddleware);
contactRoutes.use("/*", tenantMiddleware());

// Mount sub-routes
// Note: Import routes need to be mounted before /:id routes to avoid conflicts
contactRoutes.route("/", importRoutes);
contactRoutes.route("/", notesRoutes);
contactRoutes.route("/", tagsRoutes);
contactRoutes.route("/", assignmentRoutes);

/**
 * GET /contacts - List all contacts
 * Query params: search, limit, offset, includeGroups, assignedToMe, unassigned
 */
contactRoutes.get(
  "/",
  zValidator("query", listContactsQuerySchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const query = c.req.valid("query");

    // Use optimized service function that fetches contacts with last message in a single query
    // This replaces the N+1 pattern where we fetched contacts first, then queried each contact's last message
    const { contacts, total } = await getContactsWithLastMessage(tenantDb, companyId, {
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      includeGroups: query.includeGroups,
      assignedToMe: query.assignedToMe,
      unassigned: query.unassigned,
      userId: user.id,
    });

    // Type assertion needed because ContactWithLastMessage has slightly looser types than RawContactFromDb
    // (e.g., jid can be null in the service but the transformer expects it to be string)
    return successPaginated(
      c,
      transformContacts(contacts as unknown as RawContactFromDb[]),
      createPaginationMeta(total, contacts.length, {
        limit: query.limit,
        offset: query.offset,
      }),
    );
  },
);

/**
 * GET /contacts/:id - Get a specific contact
 */
contactRoutes.get("/:id", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  // Get assignment info - first get the assignment, then fetch user names separately
  const assignmentRecord = await tenantDb
    .selectFrom("contact_assignments")
    .select(["assigned_to", "assigned_by", "assigned_at"])
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .executeTakeFirst();

  // Fetch user names from public schema if we have an assignment
  let assignment:
    | {
        assigned_to: string;
        assigned_by: string;
        assigned_at: Date;
        assigned_to_name: string | null;
        assigned_to_email: string | null;
        assigned_by_name: string | null;
        assigned_by_email: string | null;
      }
    | undefined;

  if (assignmentRecord) {
    const userIds = [
      assignmentRecord.assigned_to,
      assignmentRecord.assigned_by,
    ].filter(Boolean);
    const users =
      userIds.length > 0
        ? await db
            .selectFrom("users")
            .select(["id", "name", "email"])
            .where("id", "in", userIds)
            .execute()
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const assignedToUser = userMap.get(assignmentRecord.assigned_to);
    const assignedByUser = userMap.get(assignmentRecord.assigned_by);

    assignment = {
      assigned_to: assignmentRecord.assigned_to,
      assigned_by: assignmentRecord.assigned_by,
      assigned_at: assignmentRecord.assigned_at,
      assigned_to_name: assignedToUser?.name ?? null,
      assigned_to_email: assignedToUser?.email ?? null,
      assigned_by_name: assignedByUser?.name ?? null,
      assigned_by_email: assignedByUser?.email ?? null,
    };
  }

  // Build assignment object with user names
  let assignmentWithNames = null;
  if (assignment) {
    assignmentWithNames = {
      assignedTo: assignment.assigned_to,
      assignedToName: getUserDisplayName(
        assignment.assigned_to_name,
        assignment.assigned_to_email,
        assignment.assigned_to,
      ),
      assignedBy: assignment.assigned_by,
      assignedByName: getUserDisplayName(
        assignment.assigned_by_name,
        assignment.assigned_by_email,
        assignment.assigned_by,
      ),
      assignedAt: assignment.assigned_at,
    };
  }

  // Get tags
  const tags = await tenantDb
    .selectFrom("contact_tags")
    .innerJoin("tags", "tags.id", "contact_tags.tag_id")
    .select(["tags.id", "tags.name", "tags.color"])
    .where("contact_tags.contact_id", "=", contactId)
    .execute();

  return successData(c, {
    id: contact.id,
    jid: contact.jid,
    phoneNumber: contact.phone_number || extractPhoneFromJid(contact.jid),
    pushName: contact.push_name,
    customName: contact.custom_name,
    displayName: getContactDisplayName(contact),
    name: getContactName(contact),
    isGroup: contact.is_group,
    isBlocked: contact.is_blocked,
    profilePictureUrl: contact.profile_picture_url,
    notesShared: contact.notes_shared,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    assignment: assignmentWithNames,
    tags,
  });
});

/**
 * POST /contacts - Create a new contact manually by phone number
 */
contactRoutes.post("/", zValidator("json", createContactSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const body = c.req.valid("json");

  // Normalize and validate phone number
  const phoneResult = normalizePhoneNumber(body.phoneNumber);
  if (!phoneResult.isValid) {
    return badRequest(c, phoneResult.error || "Invalid phone number");
  }

  const { cleanedPhone, jid } = phoneResult;

  // Check if contact already exists
  const existingContact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "phone_number", "custom_name", "push_name"])
    .where((eb) =>
      eb.or([eb("jid", "=", jid), eb("phone_number", "=", cleanedPhone)]),
    )
    .executeTakeFirst();

  if (existingContact) {
    return c.json(
      {
        error: "Contact already exists",
        existingContact: {
          id: existingContact.id,
          phoneNumber: existingContact.phone_number,
          displayName: getContactDisplayName(existingContact),
        },
      },
      409,
    );
  }

  // Create the contact
  const newContact = await tenantDb
    .insertInto("contacts")
    .values({
      jid,
      phone_number: cleanedPhone,
      custom_name: body.customName || null,
      notes_shared: body.notesShared || null,
      is_group: false,
    })
    .returning([
      "id",
      "jid",
      "phone_number",
      "custom_name",
      "notes_shared",
      "is_group",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  if (!newContact) {
    return serverError(c, "Failed to create contact");
  }

  return created(c, {
    id: newContact.id,
    jid: newContact.jid,
    phoneNumber: newContact.phone_number,
    customName: newContact.custom_name,
    displayName: getContactDisplayName(newContact),
    notesShared: newContact.notes_shared,
    isGroup: newContact.is_group,
    createdAt: newContact.created_at,
    updatedAt: newContact.updated_at,
  });
});

/**
 * PATCH /contacts/:id - Update a contact
 * Supports: customName, notesShared, isBlocked
 *
 * When isBlocked changes:
 * - Updates the is_blocked field in the database
 * - Creates an audit log entry (contact.blocked or contact.unblocked)
 * - Broadcasts a realtime event for real-time updates
 */
contactRoutes.patch(
  "/:id",
  zValidator("json", updateContactSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const body = c.req.valid("json");

    // First, check if the contact exists and get current block status
    const existingContact = await tenantDb
      .selectFrom("contacts")
      .select([
        "id",
        "jid",
        "custom_name",
        "push_name",
        "phone_number",
        "is_blocked",
        "is_group",
      ])
      .where("id", "=", contactId)
      .executeTakeFirst();

    if (!existingContact) {
      return notFound(c, "Contact");
    }

    const updateData: Record<string, unknown> = {
      updated_at: toDbDate(),
    };

    if (body.customName !== undefined) {
      updateData.custom_name = body.customName;
    }

    if (body.notesShared !== undefined) {
      updateData.notes_shared = body.notesShared;
    }

    // Handle block status change
    const blockStatusChanged =
      body.isBlocked !== undefined &&
      body.isBlocked !== existingContact.is_blocked;

    if (blockStatusChanged) {
      // Groups cannot be blocked
      if (existingContact.is_group) {
        return badRequest(c, "Cannot block group contacts");
      }
      updateData.is_blocked = body.isBlocked;
    }

    const updated = await tenantDb
      .updateTable("contacts")
      .set(updateData)
      .where("id", "=", contactId)
      .returning([
        "id",
        "custom_name",
        "notes_shared",
        "is_blocked",
        "updated_at",
      ])
      .executeTakeFirst();

    if (!updated) {
      return notFound(c, "Contact");
    }

    // If block status changed, create audit log and broadcast event
    if (blockStatusChanged) {
      const contactDisplayName = getContactDisplayName(
        existingContact,
        "Unknown Contact",
      );

      // Create audit log
      await createAuditLog({
        companyId,
        userId: user.id,
        action: body.isBlocked ? "contact.blocked" : "contact.unblocked",
        entityType: "contact",
        entityId: contactId,
        details: {
          contactName: contactDisplayName,
          contactJid: existingContact.jid,
        },
        ipAddress: getClientIp(c.req.raw.headers),
      });

      await broadcastToCompany(companyId, "contact:updated", {
          event: body.isBlocked ? "blocked" : "unblocked",
          contactId,
          contactName: contactDisplayName,
          isBlocked: body.isBlocked,
      });

      // Publish NATS command to WhatsApp service (fire-and-forget)
      // Only if we have a contact JID to block/unblock
      if (existingContact.jid) {
        // Get active WhatsApp connection for this company
        const connection = await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id"])
          .where("status", "=", "connected")
          .executeTakeFirst();

        if (connection) {
          if (body.isBlocked) {
            await publishBlockContact(
              companyId,
              connection.id,
              existingContact.jid,
            );
          } else {
            await publishUnblockContact(
              companyId,
              connection.id,
              existingContact.jid,
            );
          }
        }
      }
    }

    return successData(c, {
      id: updated.id,
      customName: updated.custom_name,
      notesShared: updated.notes_shared,
      isBlocked: updated.is_blocked,
      updatedAt: updated.updated_at,
    });
  },
);
