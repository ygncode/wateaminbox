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
