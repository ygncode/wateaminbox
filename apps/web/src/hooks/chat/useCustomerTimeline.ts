import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type CustomerTimelinePage,
  flattenTimelinePages,
  getCustomerTimeline,
} from "@/lib/api/customer-timeline";
import { getCompanyId } from "@/lib/api/client";

export const customerTimelineKeys = {
  all: ["customer-timeline"] as const,
  list: (chatId: string, channel?: string) =>
    [
      ...customerTimelineKeys.all,
      getCompanyId(),
      chatId,
      channel ?? "all",
    ] as const,
};

/**
 * A merged customer's history, across every channel they can be reached on.
 *
 * Keyed by the chat the reader opened rather than by the customer, because the
 * reader may arrive on any of the customer's threads and the server resolves
 * which customer that is. `channel` narrows to one channel - the switcher
 * acting as a filter - and is part of the key so switching does not show the
 * previous filter's rows while the next page loads.
 */
export function useCustomerTimeline(
  chatId: string | null | undefined,
  options: { channel?: string; limit?: number } = {},
) {
  const query = useInfiniteQuery<CustomerTimelinePage>({
    queryKey: customerTimelineKeys.list(chatId ?? "", options.channel),
    queryFn: ({ pageParam }) =>
      getCustomerTimeline(chatId!, {
        limit: options.limit ?? 50,
        cursor: pageParam as string | undefined,
        channel: options.channel,
      }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(chatId),
    staleTime: 30_000,
    gcTime: 300_000,
  });

  const messages = useMemo(
    () => (query.data ? flattenTimelinePages(query.data.pages) : []),
    [query.data],
  );

  return {
    ...query,
    messages,
    // Taken from the newest page: it is the one whose request could have
    // failed a stale history request just now.
    remoteHistory: query.data?.pages[0]?.remoteHistory,
    canonicalContactId: query.data?.pages[0]?.canonicalContactId,
  };
}
