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

import { zValidator } from "@hono/zod-validator";
import { db } from "@wateaminbox/database";
import {
  getContactDisplayName,
  getContactName,
  getUserDisplayName,
  toDbDate,
} from "@wateaminbox/shared";
import { Hono } from "hono";
import {
  getContactPhoneNumber,
  type RawContactFromDb,
  transformContacts,
} from "../../lib/data-transformers.js";
import { badRequest, notFound, serverError } from "../../lib/errors.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { created, successData, successPaginated } from "../../lib/response.js";
import { createPaginationMeta } from "../../lib/route-helpers.js";
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from "../../lib/schemas/index.js";
import { normalizePhoneNumber } from "../../lib/schemas.js";
import { getAuthorizedMediaUrlOrNull } from "../../lib/storage.js";
import { authMiddleware } from "../../middleware/auth.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import { getContactsWithLastMessage } from "../../services/contact.service.js";
import { assignmentRoutes } from "./assignment.js";
import { importRoutes } from "./import.js";
// Import sub-routes
import { notesRoutes } from "./notes.js";
import { tagsRoutes } from "./tags.js";

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

// Direct contact resources must honor assignment visibility.
contactRoutes.use("/:id", requireContactVisibility());

/**
 * GET /contacts - List all contacts
 * Query params: search, limit, offset, includeGroups, assignedToMe, unassigned
 */
contactRoutes.get(
  "/",
  zValidator("query", listContactsQuerySchema),
  async (c) => {
    const { tenantDb, user, companyId, permissions } = getRouteContext(c);
    const query = c.req.valid("query");

    // Use optimized service function that fetches contacts with last message in a single query
    // This replaces the N+1 pattern where we fetched contacts first, then queried each contact's last message
    const { contacts, total } = await getContactsWithLastMessage(
      tenantDb,
      companyId,
      {
        search: query.search,
        limit: query.limit,
        offset: query.offset,
        includeGroups: query.includeGroups,
        connectionId: query.connectionId,
        assignedToMe: query.assignedToMe,
        unassigned: query.unassigned,
        userId: user.id,
        restrictToAssigned: !permissions.can_view_all_chats,
        conversationStatus: query.conversationStatus,
      },
    );

    const authorizedContacts = await Promise.all(
      contacts.map(async (contact) => ({
        ...contact,
        profile_picture_url: await getAuthorizedMediaUrlOrNull(
          contact.profile_picture_url,
          companyId,
        ),
      })),
    );
    // Type assertion needed because ContactWithLastMessage has slightly looser types than RawContactFromDb
    // (e.g., jid can be null in the service but the transformer expects it to be string)
    return successPaginated(
      c,
      transformContacts(authorizedContacts as unknown as RawContactFromDb[]),
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
  const { tenantDb, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const connection = contact.whatsapp_connection_id
    ? await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "name", "phone_number", "status"])
        .where("id", "=", contact.whatsapp_connection_id)
        .executeTakeFirst()
    : null;

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
    phoneNumber: getContactPhoneNumber({
      is_group: contact.is_group,
      phone_number: contact.phone_number,
      jid: contact.jid || "",
    }),
    pushName: contact.push_name,
    customName: contact.custom_name,
    displayName: getContactDisplayName(contact),
    name: getContactName(contact),
    isGroup: contact.is_group,
    isBlocked: contact.is_blocked,
    isOnline: contact.is_online,
    lastSeen: contact.last_seen,
    profilePictureUrl: await getAuthorizedMediaUrlOrNull(
      contact.profile_picture_url,
      companyId,
    ),
    notesShared: contact.notes_shared,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    connection: connection
      ? {
          id: connection.id,
          name: connection.name,
          phoneNumber: connection.phone_number,
          status: connection.status,
        }
      : null,
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

  const activeConnections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select("id")
    .where("status", "=", "connected")
    .$if(Boolean(body.connectionId), (query) =>
      query.where("id", "=", body.connectionId!),
    )
    .limit(2)
    .execute();
  if (activeConnections.length === 0) {
    return badRequest(c, "No matching active WhatsApp connection");
  }
  if (!body.connectionId && activeConnections.length !== 1) {
    return badRequest(
      c,
      "connectionId is required when multiple accounts are active",
    );
  }
  const connectionId = activeConnections[0].id;

  const existingContact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "phone_number", "custom_name", "push_name"])
    .where("whatsapp_connection_id", "=", connectionId)
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
      whatsapp_connection_id: connectionId,
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
        "whatsapp_connection_id",
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

    let blockConnectionId: string | null = null;
    if (blockStatusChanged) {
      if (!existingContact.jid || !existingContact.whatsapp_connection_id) {
        return badRequest(
          c,
          "Contact is not associated with a WhatsApp connection",
        );
      }
      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select("id")
        .where("id", "=", existingContact.whatsapp_connection_id)
        .where("status", "=", "connected")
        .executeTakeFirst();
      if (!connection)
        return badRequest(c, "Contact's connection is not active");
      blockConnectionId = connection.id;
    }

    const updated = await tenantDb.transaction().execute(async (trx) => {
      const row = await trx
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

      if (blockStatusChanged && blockConnectionId && existingContact.jid) {
        await enqueueConnectionCommand(
          trx,
          companyId,
          blockConnectionId,
          (publisher) =>
            body.isBlocked
              ? publisher.blockContact(existingContact.jid!)
              : publisher.unblockContact(existingContact.jid!),
        );
      }
      return row;
    });

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
