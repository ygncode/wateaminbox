import { Hono } from "hono";
import { db } from "@whatsapp-web/database";
import { toDbDate } from "@whatsapp-web/shared";
import { createAuditLog, getClientIp } from "../services/audit.service.js";
import { notFound, badRequest, forbidden, serverError } from "../lib/errors.js";

export const contactNotesRoutes = new Hono();

/**
 * GET /contacts/:id/notes/shared - Get shared notes for a contact (paginated)
 */
contactNotesRoutes.get("/:id/notes/shared", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  // Get total count
  const countResult = await tenantDb
    .selectFrom("contact_notes_shared")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  const total = Number(countResult?.count || 0);

  // Get notes with pagination
  const notes = await tenantDb
    .selectFrom("contact_notes_shared")
    .selectAll()
    .where("contact_id", "=", contactId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return c.json({
    data: notes.map((note) => ({
      id: note.id,
      contactId: note.contact_id,
      userId: note.user_id,
      authorName: note.author_name,
      content: note.content,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + notes.length < total,
    },
  });
});

/**
 * POST /contacts/:id/notes/shared - Create a new shared note
 */
contactNotesRoutes.post("/:id/notes/shared", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { content } = body;

  if (!content || content.trim().length === 0) {
    return badRequest(c, "Content is required");
  }

  // Get author name from public.users
  const userInfo = await db
    .selectFrom("users")
    .select(["name", "email"])
    .where("id", "=", user.id)
    .executeTakeFirst();

  // Use name if available, otherwise use email prefix
  let authorName = user.id; // Fallback to ID
  if (userInfo?.name) {
    authorName = userInfo.name;
  } else if (userInfo?.email) {
    const atIndex = userInfo.email.indexOf("@");
    authorName =
      atIndex > 0 ? userInfo.email.substring(0, atIndex) : userInfo.email;
  }

  // Create the note
  const note = await tenantDb
    .insertInto("contact_notes_shared")
    .values({
      contact_id: contactId,
      user_id: user.id,
      author_name: authorName,
      content: content.trim(),
    })
    .returning([
      "id",
      "contact_id",
      "user_id",
      "author_name",
      "content",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  if (!note) {
    return serverError(c, "Failed to create note");
  }

  // Create audit log
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.note.created",
    entityType: "contact_note",
    entityId: note.id,
    details: {
      contactId,
      noteType: "shared",
      contentLength: content.trim().length,
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json(
    {
      id: note.id,
      contactId: note.contact_id,
      userId: note.user_id,
      authorName: note.author_name,
      content: note.content,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    },
    201,
  );
});

/**
 * PUT /contacts/:id/notes/shared/:noteId - Update a shared note (author only)
 */
contactNotesRoutes.put("/:id/notes/shared/:noteId", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const body = await c.req.json();

  const { content } = body;

  if (!content || content.trim().length === 0) {
    return badRequest(c, "Content is required");
  }

  // Check if note exists and user is the author
  const existingNote = await tenantDb
    .selectFrom("contact_notes_shared")
    .select(["id", "user_id", "author_name"])
    .where("id", "=", noteId)
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!existingNote) {
    return notFound(c, "Note");
  }

  // Only the author can edit (System notes are read-only)
  if (
    existingNote.user_id !== user.id ||
    existingNote.author_name === "System"
  ) {
    return forbidden(c, "Permission denied: Only the note author can edit this note");
  }

  // Update the note
  const updatedNote = await tenantDb
    .updateTable("contact_notes_shared")
    .set({
      content: content.trim(),
      updated_at: toDbDate(),
    })
    .where("id", "=", noteId)
    .returning([
      "id",
      "contact_id",
      "user_id",
      "author_name",
      "content",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  // Create audit log
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.note.updated",
    entityType: "contact_note",
    entityId: noteId,
    details: {
      contactId,
      noteType: "shared",
      contentLength: content.trim().length,
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({
    id: updatedNote?.id,
    contactId: updatedNote?.contact_id,
    userId: updatedNote?.user_id,
    authorName: updatedNote?.author_name,
    content: updatedNote?.content,
    createdAt: updatedNote?.created_at,
    updatedAt: updatedNote?.updated_at,
  });
});

/**
 * DELETE /contacts/:id/notes/shared/:noteId - Delete a shared note (author only)
 */
contactNotesRoutes.delete("/:id/notes/shared/:noteId", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");

  // Check if note exists and user is the author
  const existingNote = await tenantDb
    .selectFrom("contact_notes_shared")
    .select(["id", "user_id", "author_name"])
    .where("id", "=", noteId)
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  if (!existingNote) {
    return notFound(c, "Note");
  }

  // Only the author can delete (System notes are read-only)
  if (
    existingNote.user_id !== user.id ||
    existingNote.author_name === "System"
  ) {
    return forbidden(c, "Permission denied: Only the note author can delete this note");
  }

  // Delete the note
  await tenantDb
    .deleteFrom("contact_notes_shared")
    .where("id", "=", noteId)
    .execute();

  // Create audit log
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.note.deleted",
    entityType: "contact_note",
    entityId: noteId,
    details: {
      contactId,
      noteType: "shared",
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json({ success: true });
});

/**
 * GET /contacts/:id/notes/private - Get private notes for a contact (user's own notes only)
 */
contactNotesRoutes.get("/:id/notes/private", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  // Get total count for this user's notes
  const countResult = await tenantDb
    .selectFrom("contact_notes_private")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  const total = Number(countResult?.count || 0);

  // Get notes for this user only
  const notes = await tenantDb
    .selectFrom("contact_notes_private")
    .selectAll()
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return c.json({
    data: notes.map((note) => ({
      id: note.id,
      contactId: note.contact_id,
      userId: note.user_id,
      content: note.content,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + notes.length < total,
    },
  });
});

/**
 * POST /contacts/:id/notes/private - Create a new private note
 */
contactNotesRoutes.post("/:id/notes/private", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const { content } = body;

  if (!content || content.trim().length === 0) {
    return badRequest(c, "Content is required");
  }

  // Create new note
  const note = await tenantDb
    .insertInto("contact_notes_private")
    .values({
      contact_id: contactId,
      user_id: user.id,
      content: content.trim(),
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

  if (!note) {
    return serverError(c, "Failed to create note");
  }

  return c.json(
    {
      id: note.id,
      contactId: note.contact_id,
      userId: note.user_id,
      content: note.content,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    },
    201,
  );
});

/**
 * PUT /contacts/:id/notes/private/:noteId - Update a specific private note
 */
contactNotesRoutes.put("/:id/notes/private/:noteId", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const body = await c.req.json();

  const { content } = body;

  if (!content || content.trim().length === 0) {
    return badRequest(c, "Content is required");
  }

  // Check if note exists and belongs to user
  const existingNote = await tenantDb
    .selectFrom("contact_notes_private")
    .select(["id"])
    .where("id", "=", noteId)
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  if (!existingNote) {
    return notFound(c, "Note");
  }

  // Update the note
  const updatedNote = await tenantDb
    .updateTable("contact_notes_private")
    .set({
      content: content.trim(),
      updated_at: toDbDate(),
    })
    .where("id", "=", noteId)
    .returning([
      "id",
      "contact_id",
      "user_id",
      "content",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  return c.json({
    id: updatedNote?.id,
    contactId: updatedNote?.contact_id,
    userId: updatedNote?.user_id,
    content: updatedNote?.content,
    createdAt: updatedNote?.created_at,
    updatedAt: updatedNote?.updated_at,
  });
});

/**
 * DELETE /contacts/:id/notes/private/:noteId - Delete a specific private note
 */
contactNotesRoutes.delete("/:id/notes/private/:noteId", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");

  // Check if note exists and belongs to user
  const existingNote = await tenantDb
    .selectFrom("contact_notes_private")
    .select(["id"])
    .where("id", "=", noteId)
    .where("contact_id", "=", contactId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  if (!existingNote) {
    return notFound(c, "Note");
  }

  // Delete the note
  await tenantDb
    .deleteFrom("contact_notes_private")
    .where("id", "=", noteId)
    .execute();

  return c.json({ success: true });
});
