import { Hono } from "hono";
import { db } from "@whatsapp-web/database";
import {
  toDbDate,
  getContactDisplayName,
  getContactName,
  extractPhoneFromJid,
  getUserDisplayName,
} from "@whatsapp-web/shared";
import { authMiddleware } from "../middleware/auth.js";
import { notFound, badRequest, serverError } from "../lib/errors.js";
import { extractPaginationParams, createPaginationMeta } from "../lib/route-helpers.js";
import { transformContacts } from "../lib/data-transformers.js";
import { normalizePhoneNumber } from "../lib/schemas.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import { getContactsWithLastMessage } from "../services/contact.service.js";
import { createLogger } from "../lib/logger.js";

// Import sub-routes
import { contactNotesRoutes } from "./contact-notes.routes.js";
import { contactTagsRoutes } from "./contact-tags.routes.js";
import { contactAssignmentRoutes } from "./contact-assignment.routes.js";
import { contactImportRoutes } from "./contact-import.routes.js";

const logger = createLogger("ContactRoutes");

export const contactRoutes = new Hono();

// All contact routes require authentication and tenant context
contactRoutes.use("/*", authMiddleware);
contactRoutes.use("/*", tenantMiddleware());

// Mount sub-routes
// Note: Import routes need to be mounted before /:id routes to avoid conflicts
contactRoutes.route("/", contactImportRoutes);
contactRoutes.route("/", contactNotesRoutes);
contactRoutes.route("/", contactTagsRoutes);
contactRoutes.route("/", contactAssignmentRoutes);

/**
 * GET /contacts - List all contacts
 * Query params: search, limit, offset, includeGroups, assignedToMe, unassigned
 */
contactRoutes.get("/", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const search = c.req.query("search");
  const { limit, offset } = extractPaginationParams(c);
  const includeGroups = c.req.query("includeGroups") === "true";
  const assignedToMe = c.req.query("assignedToMe") === "true";
  const unassigned = c.req.query("unassigned") === "true";

  // Use optimized service function that fetches contacts with last message in a single query
  // This replaces the N+1 pattern where we fetched contacts first, then queried each contact's last message
  const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
    search,
    limit,
    offset,
    includeGroups,
    assignedToMe,
    unassigned,
    userId: user.id,
  });

  return c.json({
    data: transformContacts(contacts),
    pagination: createPaginationMeta(total, contacts.length, { limit, offset }),
  });
});

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

  return c.json({
    id: contact.id,
    jid: contact.jid,
    phoneNumber: contact.phone_number || extractPhoneFromJid(contact.jid),
    pushName: contact.push_name,
    customName: contact.custom_name,
    displayName: getContactDisplayName(contact),
    name: getContactName(contact),
    isGroup: contact.is_group,
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
contactRoutes.post("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const body = await c.req.json();

  const { phoneNumber, customName, notesShared } = body;

  if (!phoneNumber) {
    return badRequest(c, "phoneNumber is required");
  }

  // Normalize and validate phone number
  const phoneResult = normalizePhoneNumber(phoneNumber);
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
      custom_name: customName || null,
      notes_shared: notesShared || null,
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

  return c.json(
    {
      id: newContact.id,
      jid: newContact.jid,
      phoneNumber: newContact.phone_number,
      customName: newContact.custom_name,
      displayName: getContactDisplayName(newContact),
      notesShared: newContact.notes_shared,
      isGroup: newContact.is_group,
      createdAt: newContact.created_at,
      updatedAt: newContact.updated_at,
    },
    201,
  );
});

/**
 * PATCH /contacts/:id - Update a contact
 */
contactRoutes.patch("/:id", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { customName, notesShared } = body;

  const updateData: Record<string, unknown> = {
    updated_at: toDbDate(),
  };

  if (customName !== undefined) {
    updateData.custom_name = customName;
  }

  if (notesShared !== undefined) {
    updateData.notes_shared = notesShared;
  }

  const updated = await tenantDb
    .updateTable("contacts")
    .set(updateData)
    .where("id", "=", contactId)
    .returning(["id", "custom_name", "notes_shared", "updated_at"])
    .executeTakeFirst();

  if (!updated) {
    return notFound(c, "Contact");
  }

  return c.json({
    id: updated.id,
    customName: updated.custom_name,
    notesShared: updated.notes_shared,
    updatedAt: updated.updated_at,
  });
});
