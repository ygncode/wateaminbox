/** A sliding window bounds memory and the work of an authoritative refetch. */
export const CHAT_PAGE_SIZE = 100;
export const CHAT_WINDOW_PAGES = 5;

export function previousChatOffset(offset: number, pageSize: number) {
  return offset > 0 ? Math.max(0, offset - pageSize) : undefined;
}
