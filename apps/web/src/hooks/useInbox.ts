import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
} from "@tanstack/react-query";
import type { ChannelConversation } from "@/lib/api/channel-conversations";
import {
  buildQueryString,
  fetchApi,
  getAccessToken,
  getCompanyId,
} from "@/lib/api/client";
import {
  type ContactApiResponse,
  transformChannelConversationToChat,
  transformContactToChat,
} from "@/lib/api/transformers";
import type { Chat } from "@/types/chat";
import { CHAT_PAGE_SIZE, CHAT_WINDOW_PAGES } from "./chat-list-window";
import { queryKeys } from "./query-keys";
import type { AssignmentFilter, ConversationStatusFilter } from "./useChats";

/**
 * The unified inbox (GET /api/inbox): every channel in one server-side order,
 * paged by cursor. It replaced fetching WhatsApp contacts and channel threads
 * separately and interleaving them in the browser, which mis-ordered rows past
 * the first page and briefly showed whichever list answered first.
 */
export interface InboxFilters {
  search?: string;
  includeGroups?: boolean;
  assignmentFilter?: AssignmentFilter;
  accountId?: string;
  conversationStatus?: ConversationStatusFilter;
  tagIds?: readonly string[];
  /** The navigation badge keeps its own single page. */
  headOnly?: boolean;
}

type InboxApiItem =
  | { type: "contact"; contact: ContactApiResponse }
  | {
      type: "conversation";
      conversation: ChannelConversation & { assignedTo?: string | null };
    };

interface InboxApiResponse {
  data: InboxApiItem[];
  nextCursor: string | null;
  prevCursor: string | null;
  /** Present on the first page only. */
  unreadTotal: number | null;
}

export interface InboxPage {
  chats: Chat[];
  nextCursor: string | null;
  prevCursor: string | null;
  unreadTotal: number | null;
}

/** A page boundary: the cursor and which way it pages. */
export type InboxPageParam =
  | { cursor?: undefined; before?: undefined }
  | { cursor: string; before?: undefined }
  | { before: string; cursor?: undefined };

export const inboxKeys = {
  all: () => [...queryKeys.chats.lists(), "inbox"] as const,
  list: (filters: InboxFilters) =>
    [...queryKeys.chats.lists(), "inbox", filters] as const,
};

export function inboxItemToChat(item: InboxApiItem): Chat {
  if (item.type === "contact") return transformContactToChat(item.contact);
  const chat = transformChannelConversationToChat(item.conversation);
  return {
    ...chat,
    accountIds: [item.conversation.channelAccountId],
    assignedTo: item.conversation.assignedTo ?? undefined,
  };
}

export function buildInboxQueryParams(
  filters: InboxFilters,
  page: InboxPageParam,
  limit = CHAT_PAGE_SIZE,
): Record<string, string | number> {
  const params: Record<string, string | number> = { limit };
  if (page.cursor) params.cursor = page.cursor;
  if (page.before) params.before = page.before;
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.includeGroups === false) params.includeGroups = "false";
  if (filters.accountId) params.accountId = filters.accountId;
  if (filters.tagIds?.length) params.tagIds = filters.tagIds.join(",");
  if (filters.assignmentFilter && filters.assignmentFilter !== "all") {
    params.filter = filters.assignmentFilter;
  }
  params.conversationStatus = filters.conversationStatus ?? "open";
  return params;
}

/** Flatten pages, keeping the first copy if activity moved a row between pages. */
export function selectInboxChats(
  data: InfiniteData<InboxPage, InboxPageParam>,
): Chat[] {
  const chats = new Map<string, Chat>();
  for (const page of data.pages) {
    for (const chat of page.chats) {
      if (!chats.has(chat.id)) chats.set(chat.id, chat);
    }
  }
  return [...chats.values()];
}

export function inboxQueryOptions(filters: InboxFilters = {}) {
  const companyId = getCompanyId();
  return infiniteQueryOptions({
    queryKey: inboxKeys.list(filters),
    initialPageParam: {} as InboxPageParam,
    maxPages: filters.headOnly ? 1 : CHAT_WINDOW_PAGES,
    getNextPageParam: (lastPage: InboxPage): InboxPageParam | undefined =>
      lastPage.nextCursor ? { cursor: lastPage.nextCursor } : undefined,
    getPreviousPageParam: (firstPage: InboxPage): InboxPageParam | undefined =>
      firstPage.prevCursor ? { before: firstPage.prevCursor } : undefined,
    queryFn: async ({ pageParam, signal }): Promise<InboxPage> => {
      // ProtectedRoute redirects when there is no session or workspace.
      if (!getAccessToken() || !companyId) {
        return {
          chats: [],
          nextCursor: null,
          prevCursor: null,
          unreadTotal: 0,
        };
      }
      const result = await fetchApi<InboxApiResponse>(
        `/inbox${buildQueryString(buildInboxQueryParams(filters, pageParam))}`,
        { signal },
      );
      return {
        chats: result.data.map(inboxItemToChat),
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor,
        unreadTotal: result.unreadTotal ?? null,
      };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** The sidebar's chat list. */
export function useInbox(filters: InboxFilters) {
  return useInfiniteQuery({
    ...inboxQueryOptions(filters),
    select: selectInboxChats,
  });
}

/** Options for the navigation badge: the default inbox's first page only. */
export function inboxHeadQueryOptions() {
  return inboxQueryOptions({ headOnly: true });
}

/** Unread total for the navigation badge, across every channel. */
export function useInboxUnreadTotal(): number {
  const { data } = useInfiniteQuery({
    ...inboxHeadQueryOptions(),
    select: (pages) => pages.pages[0]?.unreadTotal ?? 0,
  });
  return data ?? 0;
}
