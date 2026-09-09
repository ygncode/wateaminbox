/**
 * Pure inbox-filter rules for the chat list: the order the status pills are
 * offered in, and the browser-local persistence that survives a refresh.
 * Kept free of React so the ordering and the storage round-trip can be
 * unit-tested without rendering.
 *
 * Only the two toolbar rows are persisted. The connection select and the tag
 * filters reference server-side entities that can disappear between sessions,
 * so they keep starting from a clean slate.
 */

import type {
  AssignmentFilter,
  ConversationStatusFilter,
} from "../../hooks/useChats";

export const CHAT_LIST_FILTERS_KEY = "wateaminbox:chat-list-filters";

/**
 * "All" leads so the broadest view is the first thing scanned, then the
 * lifecycle narrows left to right: Open, Pending, Resolved.
 */
export const CONVERSATION_STATUS_OPTIONS = [
  { value: "all", labelKey: "chat.all", label: "All" },
  { value: "open", labelKey: "chat.open", label: "Open" },
  { value: "pending", labelKey: "chat.pending", label: "Pending" },
  { value: "resolved", labelKey: "chat.resolved", label: "Resolved" },
] as const satisfies ReadonlyArray<{
  value: ConversationStatusFilter;
  labelKey: string;
  label: string;
}>;

const STATUS_VALUES: ReadonlySet<string> = new Set(
  CONVERSATION_STATUS_OPTIONS.map((option) => option.value),
);

const ASSIGNMENT_VALUES: ReadonlySet<string> = new Set<AssignmentFilter>([
  "all",
  "unread",
  "assignedToMe",
  "unassigned",
]);

export interface ChatListFilters {
  status: ConversationStatusFilter;
  assignment: AssignmentFilter;
}

/**
 * Every conversation, assigned to anyone: the widest view, so a first-time
 * user sees their whole inbox before narrowing it. Once they pick something
 * else it is remembered, and these defaults only come back for a browser with
 * nothing stored.
 */
export const DEFAULT_CHAT_LIST_FILTERS: ChatListFilters = {
  status: "all",
  assignment: "all",
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage access can throw outright when cookies/site data are blocked.
    return null;
  }
}

/**
 * Restores the last-used filters. Each field falls back independently, so a
 * value retired by a later release only resets the field it belongs to.
 */
export function readChatListFilters(
  store: StorageLike | null = storage(),
): ChatListFilters {
  let raw: string | null = null;
  try {
    raw = store?.getItem(CHAT_LIST_FILTERS_KEY) ?? null;
  } catch {
    return DEFAULT_CHAT_LIST_FILTERS;
  }
  if (!raw) return DEFAULT_CHAT_LIST_FILTERS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CHAT_LIST_FILTERS;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_CHAT_LIST_FILTERS;
  }

  const { status, assignment } = parsed as Partial<
    Record<keyof ChatListFilters, unknown>
  >;
  return {
    status:
      typeof status === "string" && STATUS_VALUES.has(status)
        ? (status as ConversationStatusFilter)
        : DEFAULT_CHAT_LIST_FILTERS.status,
    assignment:
      typeof assignment === "string" && ASSIGNMENT_VALUES.has(assignment)
        ? (assignment as AssignmentFilter)
        : DEFAULT_CHAT_LIST_FILTERS.assignment,
  };
}

/**
 * Remembers the filters for this browser. Failures are ignored: the inbox
 * simply opens on the defaults next time.
 */
export function writeChatListFilters(
  filters: ChatListFilters,
  store: StorageLike | null = storage(),
): void {
  try {
    store?.setItem(CHAT_LIST_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage failures (private mode, quota, blocked site data).
  }
}

/**
 * The account that routes a chat, whatever channel it is on.
 *
 * The inbox scope compares against this for every row. Both sides have to
 * resolve the same way or the filter is asymmetric: leaning on the server's
 * WhatsApp-only narrowing left merged channel rows untouched, so choosing a
 * WhatsApp number still listed Telegram chats beside it.
 *
 * A linked-device chat is owned by its WhatsApp connection even once a
 * bridged conversation row exists, because the connection is what the scope
 * selector names. `null` means the chat cannot be attributed to any account,
 * so it belongs only to the unscoped view.
 */
export function resolveOwningAccountId(
  chat: {
    contact: {
      connection?: { id: string } | null;
      conversationId?: string | null;
    };
  },
  channelConversations: ReadonlyArray<{ id: string; channelAccountId: string }>,
): string | null {
  if (chat.contact.connection?.id) return chat.contact.connection.id;
  const conversationId = chat.contact.conversationId;
  if (!conversationId) return null;
  return (
    channelConversations.find(
      (conversation) => conversation.id === conversationId,
    )?.channelAccountId ?? null
  );
}

export interface InboxAccountSource {
  id: string;
  status: string;
}

/**
 * The accounts the inbox scope selector offers, in one list.
 *
 * The spine mirrors every WhatsApp connection into a channel account under
 * the same id, so concatenating the two sources listed each WhatsApp number
 * twice - two rows with identical names and icons and no way to tell which
 * was which. The connection is the entry that survives, because it is what
 * the rest of the inbox attributes chats to (see `resolveOwningAccountId`);
 * the spine's copy is internal.
 *
 * Deduplicating on id rather than on name is deliberate: two different
 * numbers may legitimately share a label, and hiding one of those would be a
 * worse bug than the one this fixes.
 */
export function dedupeInboxAccounts<
  TWhatsApp extends InboxAccountSource,
  TChannel extends InboxAccountSource,
>(connections: readonly TWhatsApp[], channelAccounts: readonly TChannel[]) {
  const owned = new Set(connections.map((connection) => connection.id));
  return {
    connections,
    channelAccounts: channelAccounts.filter(
      (account) => !owned.has(account.id),
    ),
  };
}
