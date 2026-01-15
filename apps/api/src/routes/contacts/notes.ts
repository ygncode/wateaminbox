import { Hono } from "hono";
import { toDbDate } from "@whatsapp-web/shared";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  extractPaginationParams,
  createPaginationMeta,
} from "../../lib/route-helpers.js";
import {
  notFound,
  badRequest,
  forbidden,
  serverError,
} from "../../lib/errors.js";
import { successMessage } from "../../lib/response.js";
import {
  validateNoteContent,
  transformSharedNoteResponse,
  transformPrivateNoteResponse,
  getAuthorName,
  canModifySharedNote,
} from "../../services/note.service.js";

export const notesRoutes = new Hono();

/**
 * GET /contacts/:id/notes/shared - Get shared notes for a contact (paginated)
 */
notesRoutes.get("/:id/notes/shared", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const { limit, offset } = extractPaginationParams(c, 20);

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
    data: notes.map(transformSharedNoteResponse),
    pagination: createPaginationMeta(total, notes.length, { limit, offset }),
  });
});

/**
 * POST /contacts/:id/notes/shared - Create a new shared note
 */
notesRoutes.post("/:id/notes/shared", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const validation = validateNoteContent(body.content);
  if (!validation.valid) {
    return badRequest(c, validation.error);
  }

  const authorName = await getAuthorName(user.id);

  // Create the note
  const note = await tenantDb
    .insertInto("contact_notes_shared")
    .values({
      contact_id: contactId,
      user_id: user.id,
      author_name: authorName,
      content: validation.trimmed,
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
      contentLength: validation.trimmed.length,
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json(transformSharedNoteResponse(note), 201);
});

/**
 * PUT /contacts/:id/notes/shared/:noteId - Update a shared note (author only)
 */
notesRoutes.put("/:id/notes/shared/:noteId", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const body = await c.req.json();

  const validation = validateNoteContent(body.content);
  if (!validation.valid) {
    return badRequest(c, validation.error);
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

  const permission = canModifySharedNote(existingNote, user.id);
  if (!permission.allowed) {
    return forbidden(c, `Permission denied: ${permission.reason}`);
  }

  // Update the note
  const updatedNote = await tenantDb
    .updateTable("contact_notes_shared")
    .set({
      content: validation.trimmed,
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
      contentLength: validation.trimmed.length,
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  return c.json(transformSharedNoteResponse(updatedNote!));
});

/**
 * DELETE /contacts/:id/notes/shared/:noteId - Delete a shared note (author only)
 */
notesRoutes.delete("/:id/notes/shared/:noteId", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
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

  const permission = canModifySharedNote(existingNote, user.id);
  if (!permission.allowed) {
    return forbidden(c, `Permission denied: ${permission.reason}`);
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

  return successMessage(c, "Note deleted");
});

/**
 * GET /contacts/:id/notes/private - Get private notes for a contact (user's own notes only)
 */
notesRoutes.get("/:id/notes/private", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const contactId = c.req.param("id");
  const { limit, offset } = extractPaginationParams(c, 20);

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
    data: notes.map((note) =>
      transformPrivateNoteResponse({
        ...note,
        content: note.content ?? "",
      }),
    ),
    pagination: createPaginationMeta(total, notes.length, { limit, offset }),
  });
});

/**
 * POST /contacts/:id/notes/private - Create a new private note
 */
notesRoutes.post("/:id/notes/private", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const contactId = c.req.param("id");
  const body = await c.req.json();

  const validation = validateNoteContent(body.content);
  if (!validation.valid) {
    return badRequest(c, validation.error);
  }

  // Create new note
  const note = await tenantDb
    .insertInto("contact_notes_private")
    .values({
      contact_id: contactId,
      user_id: user.id,
      content: validation.trimmed,
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
    transformPrivateNoteResponse({
      ...note,
      content: note.content ?? "",
    }),
    201,
  );
});

/**
 * PUT /contacts/:id/notes/private/:noteId - Update a specific private note
 */
notesRoutes.put("/:id/notes/private/:noteId", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const contactId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const body = await c.req.json();

  const validation = validateNoteContent(body.content);
  if (!validation.valid) {
    return badRequest(c, validation.error);
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
      content: validation.trimmed,
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

  return c.json(
    transformPrivateNoteResponse({
      ...updatedNote!,
      content: updatedNote!.content ?? "",
    }),
  );
});

/**
 * DELETE /contacts/:id/notes/private/:noteId - Delete a specific private note
 */
notesRoutes.delete("/:id/notes/private/:noteId", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
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

  return successMessage(c, "Note deleted");
});
