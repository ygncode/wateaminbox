import { db } from "@wateaminbox/database";
import { getUserDisplayName } from "@wateaminbox/shared";

/**
 * Shared and private note types for response transformation
 */
export interface SharedNoteRecord {
  id: string;
  contact_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface PrivateNoteRecord {
  id: string;
  contact_id: string;
  user_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface SharedNoteResponse {
  id: string;
  contactId: string;
  userId: string;
  authorName: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivateNoteResponse {
  id: string;
  contactId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Validate note content.
 * Returns trimmed content if valid, null if invalid.
 *
 * @param content - The note content to validate
 * @returns Trimmed content string or null if invalid
 */
export function validateNoteContent(
  content: unknown,
): { valid: true; trimmed: string } | { valid: false; error: string } {
  if (!content || typeof content !== "string") {
    return { valid: false, error: "Content is required" };
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Content is required" };
  }

  return { valid: true, trimmed };
}

/**
 * Transform a shared note database record to API response format.
 *
 * @param note - Database record for shared note
 * @returns Formatted response object
 */
export function transformSharedNoteResponse(
  note: SharedNoteRecord,
): SharedNoteResponse {
  return {
    id: note.id,
    contactId: note.contact_id,
    userId: note.user_id,
    authorName: note.author_name,
    content: note.content,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

/**
 * Transform a private note database record to API response format.
 *
 * @param note - Database record for private note
 * @returns Formatted response object
 */
export function transformPrivateNoteResponse(
  note: PrivateNoteRecord,
): PrivateNoteResponse {
  return {
    id: note.id,
    contactId: note.contact_id,
    userId: note.user_id,
    content: note.content,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

/**
 * Get author display name from user ID.
 * Looks up user in public schema and returns display name.
 *
 * @param userId - User ID to look up
 * @returns Display name (name, email prefix, or user ID as fallback)
 */
export async function getAuthorName(userId: string): Promise<string> {
  const userInfo = await db
    .selectFrom("users")
    .select(["name", "email"])
    .where("id", "=", userId)
    .executeTakeFirst();

  return getUserDisplayName(
    userInfo?.name ?? null,
    userInfo?.email ?? null,
    userId,
  );
}

/**
 * Check if a user can modify a shared note.
 * Users can only modify their own notes, and system notes are read-only.
 *
 * @param note - The existing note record
 * @param userId - The user attempting to modify
 * @returns Object with allowed flag and reason if not allowed
 */
export function canModifySharedNote(
  note: { user_id: string; author_name: string },
  userId: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (note.author_name === "System") {
    return { allowed: false, reason: "System notes are read-only" };
  }

  if (note.user_id !== userId) {
    return {
      allowed: false,
      reason: "Only the note author can modify this note",
    };
  }

  return { allowed: true };
}
