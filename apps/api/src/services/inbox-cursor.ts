import { type RawBuilder, type SqlBool, sql } from "kysely";

/**
 * Keyset position in the unified inbox.
 *
 * The inbox interleaves two row kinds - customer rows (contacts) and channel
 * threads that have no contact (e.g. Telegram) - in one order:
 *
 *   activity DESC NULLS LAST, kind ASC (contact before thread), id DESC
 *
 * Activity is carried as integer microseconds since the epoch, as text, so a
 * PostgreSQL `timestamptz` round-trips exactly. A JavaScript `Date` keeps only
 * milliseconds: rows sharing a millisecond would compare equal, and a cursor
 * built from one would skip or repeat its neighbours.
 */
export interface InboxCursor {
  /** Activity in epoch microseconds, or null for a row with no activity. */
  activityUs: string | null;
  /** 0 = contact row, 1 = channel thread. */
  kind: InboxRowKind;
  id: string;
}

export type InboxRowKind = 0 | 1;
export const CONTACT_ROW: InboxRowKind = 0;
export const THREAD_ROW: InboxRowKind = 1;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICROS_PATTERN = /^-?\d{1,20}$/;

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.activityUs, cursor.kind, cursor.id]),
  ).toString("base64url");
}

/** Returns null for anything that is not a cursor this server issued. */
export function decodeInboxCursor(value: string): InboxCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [activityUs, kind, id] = parsed;
    if (activityUs !== null && !MICROS_PATTERN.test(String(activityUs))) {
      return null;
    }
    if (typeof activityUs !== "string" && activityUs !== null) return null;
    if (kind !== CONTACT_ROW && kind !== THREAD_ROW) return null;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
    return { activityUs, kind, id: id.toLowerCase() };
  } catch {
    return null;
  }
}

/** SQL expression for a timestamptz as epoch microseconds (text). */
export function activityMicrosSql(
  activity: RawBuilder<unknown>,
): RawBuilder<string | null> {
  return sql<
    string | null
  >`floor(extract(epoch from ${activity}) * 1000000)::bigint::text`;
}

/**
 * Rows of `rowKind` that come strictly after `cursor` in inbox order.
 *
 * Within one activity value contacts precede threads, so a thread cursor
 * excludes every contact at its activity and a contact cursor admits every
 * thread at its activity; rows of the cursor's own kind continue by id.
 */
export function afterInboxCursorSql(
  activity: RawBuilder<unknown>,
  id: RawBuilder<unknown>,
  rowKind: InboxRowKind,
  cursor: InboxCursor,
): RawBuilder<SqlBool> {
  const sameActivityTail =
    rowKind < cursor.kind
      ? sql<SqlBool>`FALSE`
      : rowKind > cursor.kind
        ? sql<SqlBool>`TRUE`
        : sql<SqlBool>`${id} < ${cursor.id}::uuid`;
  if (cursor.activityUs === null) {
    return sql<SqlBool>`(${activity} IS NULL AND ${sameActivityTail})`;
  }
  const bound = sql`(timestamptz 'epoch' + ${cursor.activityUs}::bigint * interval '1 microsecond')`;
  return sql<SqlBool>`(
    ${activity} IS NULL
    OR ${activity} < ${bound}
    OR (${activity} = ${bound} AND ${sameActivityTail})
  )`;
}

/**
 * Rows of `rowKind` that come strictly before `cursor` in inbox order (newer
 * activity, or the same activity earlier in the tie-break). The mirror image
 * of afterInboxCursorSql, used to page back towards the top of the inbox.
 */
export function beforeInboxCursorSql(
  activity: RawBuilder<unknown>,
  id: RawBuilder<unknown>,
  rowKind: InboxRowKind,
  cursor: InboxCursor,
): RawBuilder<SqlBool> {
  const sameActivityHead =
    rowKind < cursor.kind
      ? sql<SqlBool>`TRUE`
      : rowKind > cursor.kind
        ? sql<SqlBool>`FALSE`
        : sql<SqlBool>`${id} > ${cursor.id}::uuid`;
  if (cursor.activityUs === null) {
    return sql<SqlBool>`(${activity} IS NOT NULL OR ${sameActivityHead})`;
  }
  const bound = sql`(timestamptz 'epoch' + ${cursor.activityUs}::bigint * interval '1 microsecond')`;
  return sql<SqlBool>`(
    ${activity} > ${bound}
    OR (${activity} = ${bound} AND ${sameActivityHead})
  )`;
}

export type InboxDirection = "after" | "before";

/** Inbox order as a comparator, matching the SQL above exactly. */
export function compareInboxKeys(
  left: InboxCursor,
  right: InboxCursor,
): number {
  if (left.activityUs !== right.activityUs) {
    if (left.activityUs === null) return 1;
    if (right.activityUs === null) return -1;
    const a = BigInt(left.activityUs);
    const b = BigInt(right.activityUs);
    if (a !== b) return a > b ? -1 : 1;
  }
  if (left.kind !== right.kind) return left.kind - right.kind;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}
