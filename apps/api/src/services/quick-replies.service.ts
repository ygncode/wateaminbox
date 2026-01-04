import { getTenantConnection } from "./tenant.service.js";

/**
 * Quick reply interface
 */
export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a quick reply
 */
export interface CreateQuickReplyInput {
  shortcut: string;
  title: string;
  content: string;
}

/**
 * Input for updating a quick reply
 */
export interface UpdateQuickReplyInput {
  shortcut?: string;
  title?: string;
  content?: string;
}

/**
 * Maps database row to QuickReply interface
 */
function mapRowToQuickReply(row: {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}): QuickReply {
  return {
    id: row.id,
    shortcut: row.shortcut,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Gets all quick replies for a company
 */
export async function getQuickReplies(
  companyId: string,
  options?: {
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ quickReplies: QuickReply[]; total: number }> {
  const tenantDb = getTenantConnection(companyId);
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let query = tenantDb.selectFrom("quick_replies").selectAll();

  // Apply search filter if provided
  if (options?.search) {
    const searchTerm = `%${options.search.toLowerCase()}%`;
    query = query.where((eb) =>
      eb.or([
        eb("shortcut", "ilike", searchTerm),
        eb("title", "ilike", searchTerm),
        eb("content", "ilike", searchTerm),
      ]),
    );
  }

  // Get total count
  let countQuery = tenantDb
    .selectFrom("quick_replies")
    .select((eb) => eb.fn.countAll<number>().as("count"));

  if (options?.search) {
    const searchTerm = `%${options.search.toLowerCase()}%`;
    countQuery = countQuery.where((eb) =>
      eb.or([
        eb("shortcut", "ilike", searchTerm),
        eb("title", "ilike", searchTerm),
        eb("content", "ilike", searchTerm),
      ]),
    );
  }

  const [rows, countResult] = await Promise.all([
    query.orderBy("shortcut", "asc").limit(limit).offset(offset).execute(),
    countQuery.executeTakeFirst(),
  ]);

  return {
    quickReplies: rows.map(mapRowToQuickReply),
    total: Number(countResult?.count ?? 0),
  };
}

/**
 * Gets a quick reply by ID
 */
export async function getQuickReplyById(
  companyId: string,
  quickReplyId: string,
): Promise<QuickReply | null> {
  const tenantDb = getTenantConnection(companyId);

  const row = await tenantDb
    .selectFrom("quick_replies")
    .selectAll()
    .where("id", "=", quickReplyId)
    .executeTakeFirst();

  return row ? mapRowToQuickReply(row) : null;
}

/**
 * Gets a quick reply by shortcut
 */
export async function getQuickReplyByShortcut(
  companyId: string,
  shortcut: string,
): Promise<QuickReply | null> {
  const tenantDb = getTenantConnection(companyId);

  const row = await tenantDb
    .selectFrom("quick_replies")
    .selectAll()
    .where("shortcut", "=", shortcut)
    .executeTakeFirst();

  return row ? mapRowToQuickReply(row) : null;
}

/**
 * Creates a new quick reply
 */
export async function createQuickReply(
  companyId: string,
  userId: string,
  input: CreateQuickReplyInput,
): Promise<QuickReply> {
  const tenantDb = getTenantConnection(companyId);

  // Check for duplicate shortcut
  const existing = await getQuickReplyByShortcut(companyId, input.shortcut);
  if (existing) {
    throw new Error(
      `Quick reply with shortcut "${input.shortcut}" already exists`,
    );
  }

  const row = await tenantDb
    .insertInto("quick_replies")
    .values({
      shortcut: input.shortcut,
      title: input.title,
      content: input.content,
      created_by: userId,
    })
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    throw new Error("Failed to create quick reply");
  }

  return mapRowToQuickReply(row);
}

/**
 * Updates a quick reply
 */
export async function updateQuickReply(
  companyId: string,
  quickReplyId: string,
  input: UpdateQuickReplyInput,
): Promise<QuickReply | null> {
  const tenantDb = getTenantConnection(companyId);

  // Check if quick reply exists
  const existing = await getQuickReplyById(companyId, quickReplyId);
  if (!existing) {
    return null;
  }

  // Check for duplicate shortcut if shortcut is being changed
  if (input.shortcut && input.shortcut !== existing.shortcut) {
    const duplicateShortcut = await getQuickReplyByShortcut(
      companyId,
      input.shortcut,
    );
    if (duplicateShortcut) {
      throw new Error(
        `Quick reply with shortcut "${input.shortcut}" already exists`,
      );
    }
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updated_at: new Date(),
  };

  if (input.shortcut !== undefined) {
    updateData.shortcut = input.shortcut;
  }

  if (input.title !== undefined) {
    updateData.title = input.title;
  }

  if (input.content !== undefined) {
    updateData.content = input.content;
  }

  const row = await tenantDb
    .updateTable("quick_replies")
    .set(updateData)
    .where("id", "=", quickReplyId)
    .returningAll()
    .executeTakeFirst();

  return row ? mapRowToQuickReply(row) : null;
}

/**
 * Deletes a quick reply
 */
export async function deleteQuickReply(
  companyId: string,
  quickReplyId: string,
): Promise<boolean> {
  const tenantDb = getTenantConnection(companyId);

  const result = await tenantDb
    .deleteFrom("quick_replies")
    .where("id", "=", quickReplyId)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}
