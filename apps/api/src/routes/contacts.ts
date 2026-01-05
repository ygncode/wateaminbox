import type { MiddlewareHandler } from "hono"
import { Hono } from "hono";
import { db } from "@whatsapp-web/database";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requirePermission } from "../middleware/tenant.js";
import { PERMISSIONS } from "../services/permission.service.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import {
  parseCSV,
  mapToContactRow,
  importContacts,
  generateImportTemplate,
} from "../services/import.service.js";
import {
  getCurrentAssignment,
  getContactsWithLastMessage,
} from "../services/contact.service.js";
import { createNotification } from "../services/notification-history.service.js";
import { createAuditLog, getClientIp } from "../services/audit.service.js";
import { broadcastToCompany } from "./ws.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";

/**
 * Helper function to get user display names by their IDs
 * Returns a map of userId -> display name (name field, or email prefix as fallback)
 * Falls back to userId if user not found or email is malformed
 */
async function getUserNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  // Validate and filter valid UUIDs
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = Array.from(new Set(userIds)).filter((id) =>
    uuidRegex.test(id),
  );

  if (validIds.length === 0) {
    return new Map();
  }

  try {
    const users = await db
      .selectFrom("users")
      .select(["id", "name", "email"])
      .where("id", "in", validIds)
      .execute();

    const userMap = new Map<string, string>();
    for (const user of users) {
      // Use name if available, otherwise use email prefix as display name
      let displayName: string;
      if (user.name) {
        displayName = user.name;
      } else {
        // Fallback to email prefix (before @)
        const atIndex = user.email.indexOf("@");
        displayName =
          atIndex > 0 ? user.email.substring(0, atIndex) : user.email;
      }
      userMap.set(user.id, displayName);
    }

    return userMap;
  } catch (error) {
    console.error("Error fetching user names:", error);
    // Return empty map on error - callers will fall back to UUID
    return new Map();
  }
}

export const contactRoutes = new Hono();

// All contact routes require authentication and tenant context
contactRoutes.use("/*", authMiddleware);
contactRoutes.use("/*", tenantMiddleware());

// Import rate limiter: 5 requests per minute per user
// Bulk contact import is resource-intensive, so we use a strict limit
const importRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.resource.import,
      keyStrategy: "user",
      keyPrefix: "resource-import",
    })
  : async (c, next) => await next()

/**
 * GET /contacts - List all contacts
 * Query params: search, limit, offset, includeGroups, assignedToMe, unassigned
 */
contactRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const search = c.req.query("search");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
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
    data: contacts.map((contact) => {
      // Extract phone number from JID if not available
      const phoneFromJid = contact.jid?.split("@")[0] || null;
      return {
        id: contact.id,
        jid: contact.jid,
        phoneNumber: contact.phone_number || phoneFromJid,
        pushName: contact.push_name,
        customName: contact.custom_name,
        displayName:
          contact.custom_name ||
          contact.push_name ||
          contact.phone_number ||
          phoneFromJid ||
          "Unknown",
        name:
          contact.custom_name ||
          contact.push_name ||
          contact.phone_number ||
          phoneFromJid,
        isGroup: contact.is_group,
        profilePictureUrl: contact.profile_picture_url,
        notesShared: contact.notes_shared,
        lastMessageAt: contact.last_message_at,
        lastMessage: contact.last_message
          ? {
              id: contact.last_message.id,
              messageId: contact.last_message.messageId,
              fromMe: contact.last_message.fromMe,
              messageType: contact.last_message.messageType,
              content: contact.last_message.content,
              status: contact.last_message.status,
              timestamp: contact.last_message.timestamp,
            }
          : null,
        unreadCount: Number(contact.unread_count),
        assignedTo: contact.assigned_to,
        isOnline: contact.is_online,
        lastSeen: contact.last_seen,
        createdAt: contact.created_at,
        updatedAt: contact.updated_at,
      };
    }),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + contacts.length < total,
    },
  });
});

/**
 * GET /contacts/:id - Get a specific contact
 */
contactRoutes.get("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");

  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get assignment info with user names in a single query using JOINs
  const assignment = await tenantDb
    .selectFrom("contact_assignments as ca")
    .leftJoin(
      "public.users as assigned_to_user",
      "ca.assigned_to",
      "assigned_to_user.id",
    )
    .leftJoin(
      "public.users as assigned_by_user",
      "ca.assigned_by",
      "assigned_by_user.id",
    )
    .select([
      "ca.assigned_to",
      "ca.assigned_by",
      "ca.assigned_at",
      "assigned_to_user.name as assigned_to_name",
      "assigned_to_user.email as assigned_to_email",
      "assigned_by_user.name as assigned_by_name",
      "assigned_by_user.email as assigned_by_email",
    ])
    .where("ca.contact_id", "=", contactId)
    .where("ca.unassigned_at", "is", null)
    .executeTakeFirst();

  // Build assignment object with user names
  let assignmentWithNames = null;
  if (assignment) {
    // Use name if available, otherwise fall back to email prefix
    const getDisplayName = (name: string | null, email: string | null, fallbackId: string) => {
      if (name) return name;
      if (!email) return fallbackId;
      const atIndex = email.indexOf("@");
      return atIndex > 0 ? email.substring(0, atIndex) : email;
    };

    assignmentWithNames = {
      assignedTo: assignment.assigned_to,
      assignedToName: getDisplayName(
        assignment.assigned_to_name,
        assignment.assigned_to_email,
        assignment.assigned_to,
      ),
      assignedBy: assignment.assigned_by,
      assignedByName: getDisplayName(
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

  // Extract phone number from JID if not available
  const phoneFromJid = contact.jid?.split("@")[0] || null;

  return c.json({
    id: contact.id,
    jid: contact.jid,
    phoneNumber: contact.phone_number || phoneFromJid,
    pushName: contact.push_name,
    customName: contact.custom_name,
    displayName:
      contact.custom_name ||
      contact.push_name ||
      contact.phone_number ||
      phoneFromJid ||
      "Unknown",
    name:
      contact.custom_name ||
      contact.push_name ||
      contact.phone_number ||
      phoneFromJid,
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
  const tenantDb = c.get("tenantDb");
  const body = await c.req.json();

  const { phoneNumber, customName, notesShared } = body;

  if (!phoneNumber) {
    return c.json({ error: "phoneNumber is required" }, 400);
  }

  // Normalize phone number
  let cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");
  if (cleanedPhone.startsWith("+")) {
    cleanedPhone = cleanedPhone.substring(1);
  }
  if (cleanedPhone.startsWith("00")) {
    cleanedPhone = cleanedPhone.substring(2);
  }

  // Validate phone number length
  if (cleanedPhone.length < 6 || cleanedPhone.length > 15) {
    return c.json(
      { error: "Invalid phone number. Must be between 6 and 15 digits." },
      400,
    );
  }

  const jid = `${cleanedPhone}@s.whatsapp.net`;

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
          displayName:
            existingContact.custom_name ||
            existingContact.push_name ||
            existingContact.phone_number,
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
    return c.json({ error: "Failed to create contact" }, 500);
  }

  return c.json(
    {
      id: newContact.id,
      jid: newContact.jid,
      phoneNumber: newContact.phone_number,
      customName: newContact.custom_name,
      displayName: newContact.custom_name || newContact.phone_number,
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
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { customName, notesShared } = body;

  const updateData: Record<string, unknown> = {
    updated_at: new Date(),
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
    return c.json({ error: "Contact not found" }, 404);
  }

  return c.json({
    id: updated.id,
    customName: updated.custom_name,
    notesShared: updated.notes_shared,
    updatedAt: updated.updated_at,
  });
});

/**
 * POST /contacts/:id/assign - Assign contact to a user (or self)
 * Body: { targetUserId?: string } - If not provided, assigns to current user
 *
 * When reassigning from another user (takeover):
 * - Creates notification for previous assignee
 * - Broadcasts WebSocket event for real-time update
 * - Logs to audit trail
 *
 * Permission: can_assign_contacts is required to assign to another user
 * Self-assignment (claiming unassigned contacts) is allowed for all members
 */
contactRoutes.post("/:id/assign", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const permissions = c.get("companyPermissions");
  const contactId = c.req.param("id");

  // Parse optional body for targetUserId
  let targetUserId = user.id;
  try {
    const body = await c.req.json();
    if (body.targetUserId) {
      targetUserId = body.targetUserId;
    }
  } catch {
    // No body or invalid JSON - default to self-assignment
  }

  // Check permission: can_assign_contacts required to assign to someone else
  if (targetUserId !== user.id && !permissions?.can_assign_contacts) {
    return c.json(
      {
        error:
          "Permission denied: can_assign_contacts is required to assign contacts to other users",
      },
      403,
    );
  }

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number", "jid"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get contact display name
  const contactDisplayName =
    contact.custom_name ||
    contact.push_name ||
    contact.phone_number ||
    contact.jid?.split("@")[0] ||
    "Unknown Contact";

  // Get current assignment before updating
  const previousAssignment = await getCurrentAssignment(tenantDb, contactId);
  const previousAssigneeId = previousAssignment?.assigned_to;
  const isTakeover = previousAssigneeId && previousAssigneeId !== targetUserId;

  // Unassign previous assignment
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: new Date() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();

  // Create new assignment
  const assignment = await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
      assigned_to: targetUserId,
      assigned_by: user.id,
    })
    .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
    .executeTakeFirst();

  // If this is a takeover (reassigning from another user), create notification
  if (isTakeover && previousAssigneeId) {
    // Create in-app notification for previous assignee
    await createNotification(companyId, {
      userId: previousAssigneeId,
      notificationType: "assignment",
      title: "Contact Reassigned",
      message: `"${contactDisplayName}" has been reassigned to another team member`,
      actionUrl: `/chat/${contactId}`,
      metadata: {
        contactId,
        contactName: contactDisplayName,
        reassignedBy: user.id,
        newAssignee: targetUserId,
      },
    });

    // Broadcast WebSocket event for real-time update
    broadcastToCompany(companyId, {
      type: "contact",
      payload: {
        event: "reassigned",
        contactId,
        contactName: contactDisplayName,
        previousAssignee: previousAssigneeId,
        newAssignee: targetUserId,
        reassignedBy: user.id,
      },
      timestamp: new Date().toISOString(),
    });

    // Create audit log
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.assigned",
      entityType: "contact",
      entityId: contactId,
      details: {
        previousAssignee: previousAssigneeId,
        newAssignee: targetUserId,
        isTakeover: true,
        contactName: contactDisplayName,
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });
  } else {
    // Regular assignment (not a takeover)
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.assigned",
      entityType: "contact",
      entityId: contactId,
      details: {
        assignee: targetUserId,
        isTakeover: false,
        contactName: contactDisplayName,
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });
  }

  return c.json({
    success: true,
    assignment: {
      id: assignment?.id,
      assignedTo: assignment?.assigned_to,
      assignedBy: assignment?.assigned_by,
      assignedAt: assignment?.assigned_at,
    },
    wasTakeover: !!isTakeover,
    previousAssignee: previousAssigneeId || null,
  });
});

/**
 * DELETE /contacts/:id/assign - Unassign contact
 * Requires can_assign_contacts permission
 */
contactRoutes.delete(
  "/:id/assign",
  requirePermission(PERMISSIONS.CAN_ASSIGN_CONTACTS),
  async (c) => {
    const tenantDb = c.get("tenantDb");
    const contactId = c.req.param("id");

    await tenantDb
      .updateTable("contact_assignments")
      .set({ unassigned_at: new Date() })
      .where("contact_id", "=", contactId)
      .where("unassigned_at", "is", null)
      .execute();

    return c.json({ success: true });
  },
);

/**
 * GET /contacts/:id/notes/private - Get private notes for a contact
 */
contactRoutes.get("/:id/notes/private", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");

  const note = await tenantDb
    .selectFrom("contact_notes_private")
    .selectAll()
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  return c.json({
    data: note
      ? {
          id: note.id,
          contactId: note.contact_id,
          userId: note.user_id,
          content: note.content,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
        }
      : null,
  });
});

/**
 * POST /contacts/:id/notes/private - Create or update private notes for a contact
 */
contactRoutes.post("/:id/notes/private", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { content } = body;

  // Check if note exists
  const existingNote = await tenantDb
    .selectFrom("contact_notes_private")
    .select(["id"])
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  let note;
  if (existingNote) {
    // Update existing note
    note = await tenantDb
      .updateTable("contact_notes_private")
      .set({
        content,
        updated_at: new Date(),
      })
      .where("id", "=", existingNote.id)
      .returning([
        "id",
        "contact_id",
        "user_id",
        "content",
        "created_at",
        "updated_at",
      ])
      .executeTakeFirst();
  } else {
    // Create new note
    note = await tenantDb
      .insertInto("contact_notes_private")
      .values({
        contact_id: contactId,
        user_id: user.id,
        content,
      })
      .returning([
        "id",
        "contact_id",
        "user_id",
        "content",
        "created_at",
        "updated_at",
      ])
      .executeTakeFirst();
  }

  return c.json({
    id: note?.id,
    contactId: note?.contact_id,
    userId: note?.user_id,
    content: note?.content,
    createdAt: note?.created_at,
    updatedAt: note?.updated_at,
  });
});

/**
 * POST /contacts/:id/tags - Add a tag to a contact
 */
contactRoutes.post("/:id/tags", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { tagId } = body;

  if (!tagId) {
    return c.json({ error: "tagId is required" }, 400);
  }

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Check if tag exists
  const tag = await tenantDb
    .selectFrom("tags")
    .select(["id", "name", "color"])
    .where("id", "=", tagId)
    .executeTakeFirst();

  if (!tag) {
    return c.json({ error: "Tag not found" }, 404);
  }

  // Check if already tagged
  const existingTag = await tenantDb
    .selectFrom("contact_tags")
    .select(["contact_id", "tag_id"])
    .where("contact_id", "=", contactId)
    .where("tag_id", "=", tagId)
    .executeTakeFirst();

  if (existingTag) {
    return c.json({ error: "Tag already exists on contact" }, 409);
  }

  // Add tag
  await tenantDb
    .insertInto("contact_tags")
    .values({
      contact_id: contactId,
      tag_id: tagId,
    })
    .execute();

  return c.json({
    success: true,
    tag: {
      id: tag.id,
      name: tag.name,
      color: tag.color,
    },
  });
});

/**
 * DELETE /contacts/:id/tags/:tagId - Remove a tag from a contact
 */
contactRoutes.delete("/:id/tags/:tagId", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const tagId = c.req.param("tagId");

  await tenantDb
    .deleteFrom("contact_tags")
    .where("contact_id", "=", contactId)
    .where("tag_id", "=", tagId)
    .execute();

  return c.json({ success: true });
});

/**
 * GET /contacts/:id/assignments - Get assignment history for a contact
 */
contactRoutes.get("/:id/assignments", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");

  // Check if contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get all assignments (including historical ones)
  const assignments = await tenantDb
    .selectFrom("contact_assignments")
    .select([
      "id",
      "assigned_to",
      "assigned_by",
      "assigned_at",
      "unassigned_at",
    ])
    .where("contact_id", "=", contactId)
    .orderBy("assigned_at", "desc")
    .execute();

  // Collect all user IDs and fetch their names
  const userIds = assignments.flatMap((a) => [a.assigned_to, a.assigned_by]);
  const userNames = await getUserNames(userIds);

  return c.json({
    data: assignments.map((assignment) => ({
      id: assignment.id,
      assignedTo: assignment.assigned_to,
      assignedToName:
        userNames.get(assignment.assigned_to) || assignment.assigned_to,
      assignedBy: assignment.assigned_by,
      assignedByName:
        userNames.get(assignment.assigned_by) || assignment.assigned_by,
      assignedAt: assignment.assigned_at,
      unassignedAt: assignment.unassigned_at,
      isActive: assignment.unassigned_at === null,
    })),
  });
});

/**
 * GET /contacts/import/template - Download CSV template for import
 */
contactRoutes.get("/import/template", async (c) => {
  const csv = generateImportTemplate();

  c.header("Content-Type", "text/csv");
  c.header(
    "Content-Disposition",
    'attachment; filename="contact-import-template.csv"',
  );
  return c.body(csv);
});

/**
 * POST /contacts/import - Import contacts from CSV
 * Accepts: multipart/form-data with file field, or JSON with csvContent field
 * Rate limit: 5 requests per minute per user
 */
contactRoutes.post("/import", importRateLimiter, async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");

  let csvContent: string;
  let updateExisting = true;
  let createTags = true;

  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    // Handle file upload
    const formData = await c.req.formData();
    const file = formData.get("file");
    const updateExistingParam = formData.get("updateExisting");
    const createTagsParam = formData.get("createTags");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Check file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv")) {
      return c.json({ error: "Only CSV files are supported" }, 400);
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: "File size must be less than 5MB" }, 400);
    }

    csvContent = await file.text();
    updateExisting = updateExistingParam !== "false";
    createTags = createTagsParam !== "false";
  } else {
    // Handle JSON with CSV content
    const body = await c.req.json();
    if (!body.csvContent) {
      return c.json({ error: "csvContent is required" }, 400);
    }

    csvContent = body.csvContent;
    updateExisting = body.updateExisting !== false;
    createTags = body.createTags !== false;
  }

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return c.json({ error: "No valid data found in CSV" }, 400);
  }

  // Map to contact rows
  const contactRows = parsed
    .map(mapToContactRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (contactRows.length === 0) {
    return c.json(
      {
        error: "No valid contacts found. Ensure CSV has a phone_number column.",
      },
      400,
    );
  }

  // Import contacts
  const summary = await importContacts(tenantDb, contactRows, user.id, {
    updateExisting,
    createTags,
  });

  return c.json({
    success: true,
    summary: {
      total: summary.total,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      errors: summary.errors,
    },
    results: summary.results,
  });
});

/**
 * POST /contacts/import/preview - Preview import without saving
 * Rate limit: 5 requests per minute per user
 */
contactRoutes.post("/import/preview", importRateLimiter, async (c) => {
  const tenantDb = c.get("tenantDb");

  let csvContent: string;

  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    csvContent = await file.text();
  } else {
    const body = await c.req.json();
    if (!body.csvContent) {
      return c.json({ error: "csvContent is required" }, 400);
    }
    csvContent = body.csvContent;
  }

  // Parse CSV
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return c.json({ error: "No valid data found in CSV" }, 400);
  }

  // Map to contact rows
  const contactRows = parsed
    .map(mapToContactRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);

  // Batch lookup: Check which contacts already exist in a single query
  // Build arrays of phone numbers and JIDs for batch query
  const lookupData = contactRows.map((row) => {
    const phoneNumber = row.phone_number.replace(/[^\d]/g, "");
    return {
      originalPhoneNumber: row.phone_number,
      cleanPhoneNumber: phoneNumber,
      jid: `${phoneNumber}@s.whatsapp.net`,
    };
  });

  // Single query to find all existing contacts at once
  const existingContacts = await tenantDb
    .selectFrom("contacts")
    .select(["jid", "phone_number", "custom_name", "push_name"])
    .where((eb) =>
      eb.or([
        // Match by JID
        eb(
          "jid",
          "in",
          lookupData.map((d) => d.jid),
        ),
        // Match by phone number (normalized)
        eb(
          "phone_number",
          "in",
          lookupData.map((d) => d.cleanPhoneNumber),
        ),
      ]),
    )
    .execute();

  // Build a Map for O(1) existence checks - key can be jid or phone_number
  const existingMap = new Map<
    string,
    { customName: string | null; pushName: string | null }
  >();
  for (const contact of existingContacts) {
    existingMap.set(contact.jid, {
      customName: contact.custom_name,
      pushName: contact.push_name,
    });
    if (contact.phone_number) {
      existingMap.set(contact.phone_number.replace(/[^\d]/g, ""), {
        customName: contact.custom_name,
        pushName: contact.push_name,
      });
    }
  }

  // Build preview using the Map for instant lookups
  const preview = lookupData.map((data, index) => {
    const existing =
      existingMap.get(data.jid) || existingMap.get(data.cleanPhoneNumber);
    const contactRow = contactRows[index];

    return {
      row: index + 1,
      phoneNumber: data.originalPhoneNumber,
      name: contactRow.custom_name || null,
      notes: contactRow.notes || null,
      tags: contactRow.tags || null,
      exists: !!existing,
      existingName: existing?.customName || existing?.pushName || null,
    };
  });

  const existingCount = preview.filter((p) => p.exists).length;
  const newCount = preview.filter((p) => !p.exists).length;

  return c.json({
    total: preview.length,
    existingCount,
    newCount,
    preview: preview.slice(0, 100), // Limit preview to first 100 rows
  });
});
