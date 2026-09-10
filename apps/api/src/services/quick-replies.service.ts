import { AppError, ConflictError } from "../lib/errors.js";
import { getTenantConnection } from "./tenant.service.js";

/**
 * Whether a database error is a PostgreSQL `unique_violation` (SQLSTATE 23505).
 * The `node-postgres` driver surfaces the SQLSTATE on `error.code`. The DB
 * UNIQUE constraint on `quick_replies(shortcut)` is the race-free authority for
 * shortcut uniqueness; this maps its violation to the API's `409` contract.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

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

  // Let the database UNIQUE constraint on quick_replies(shortcut) be the
  // authority for uniqueness. A SELECT pre-check is non-atomic under READ
  // COMMITTED and loses a concurrent create race; the unique_violation raised
  // by the insert is the only race-free backstop. See migration 103.
  const row = await tenantDb
    .insertInto("quick_replies")
    .values({
      shortcut: input.shortcut,
      title: input.title,
      content: input.content,
      created_by: userId,
    })
    .returningAll()
    .executeTakeFirst()
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Quick reply with shortcut "${input.shortcut}" already exists`,
        );
      }
      throw error;
    });

  if (!row) {
    throw new AppError("Failed to create quick reply", 500);
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
    .transaction()
    .execute(async (trx) => {
      const updated = await trx
        .updateTable("quick_replies")
        .set(updateData)
        .where("id", "=", quickReplyId)
        .returningAll()
        .executeTakeFirst();

      // Pending automatic replies are template snapshots. Keep them in sync so
      // fixing template copy also fixes replies that have not gone out yet.
      if (updated && input.content !== undefined) {
        await trx
          .updateTable("scheduled_messages")
          .set({ content: input.content, updated_at: new Date() })
          .where("auto_reply_quick_reply_id", "=", quickReplyId)
          .where("status", "=", "scheduled")
          .execute();
      }
      return updated;
    })
    .catch((error: unknown) => {
      // A rename onto a shortcut another row already holds trips the UNIQUE
      // index on quick_replies(shortcut); the non-atomic pre-check that used
      // to guard this could not survive a concurrent rename/create race.
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Quick reply with shortcut "${
            input.shortcut ?? existing.shortcut
          }" already exists`,
        );
      }
      throw error;
    });

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

  return tenantDb.transaction().execute(async (trx) => {
    const setting = await trx
      .selectFrom("auto_reply_settings")
      .select("id")
      .where("quick_reply_id", "=", quickReplyId)
      .executeTakeFirst();
    if (setting) {
      await trx
        .updateTable("auto_reply_settings")
        .set({ enabled: false, quick_reply_id: null, updated_at: new Date() })
        .where("id", "=", setting.id)
        .execute();
      await trx
        .updateTable("scheduled_messages")
        .set({
          status: "canceled",
          canceled_at: new Date(),
          updated_at: new Date(),
        })
        .where("auto_reply_quick_reply_id", "=", quickReplyId)
        .where("status", "in", ["scheduled", "processing"])
        .execute();
    }

    const result = await trx
      .deleteFrom("quick_replies")
      .where("id", "=", quickReplyId)
      .executeTakeFirst();
    return result.numDeletedRows > 0;
  });
}
