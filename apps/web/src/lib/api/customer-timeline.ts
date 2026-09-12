import { fetchWithAuth } from "./client";
import type { Message } from "@/types/chat";

/** One page of a customer's history, oldest first within the page. */
export interface CustomerTimelinePage {
  messages: TimelineMessage[];
  canonicalContactId: string;
  hasMore: boolean;
  nextCursor: string | null;
  remoteHistory: { status: string; contactId: string | null };
}

/**
 * A message with the thread it arrived on.
 *
 * The timeline interleaves threads, so a row that does not say where it came
 * from is unreadable next to the one above it.
 */
export type TimelineMessage = Message & {
  threadId: string | null;
  channel: string | null;
  provider: string | null;
};

/**
 * One page of the merged history for a customer.
 *
 * `contactId` is whatever the chat list addressed - the conversation for a
 * neutral thread, the contact otherwise. The server resolves it to the
 * customer, so an old chat URL still reads the whole history.
 */
export async function getCustomerTimeline(
  contactId: string,
  options: { limit?: number; cursor?: string; channel?: string } = {},
): Promise<CustomerTimelinePage> {
  const query = new URLSearchParams();
  query.set("limit", String(options.limit ?? 50));
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.channel) query.set("channel", options.channel);
  // `fetchWithAuth` unwraps the `{ data }` envelope, so this is the payload.
  return await fetchWithAuth<CustomerTimelinePage>(
    `/contacts/${encodeURIComponent(contactId)}/timeline?${query.toString()}`,
  );
}

/**
 * Every loaded page as one history, oldest first.
 *
 * Pages walk backwards in time while each page reads forwards, so the page
 * order is reversed before flattening. Sorting the result instead would hide a
 * pagination bug rather than surface it: the server already returns a total
 * order, and a row arriving out of place means the cursor is wrong.
 */
export function flattenTimelinePages(
  pages: readonly CustomerTimelinePage[],
): TimelineMessage[] {
  return [...pages].reverse().flatMap((page) => page.messages);
}
