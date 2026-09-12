/**
 * The `?thread=` parameter that lets one inbox row hold several threads.
 *
 * A merged customer keeps a separate conversation per channel - a merge never
 * combines them - so the row in the path names the customer and this parameter
 * names the thread being read. Kept pure and separate from the router so the
 * transitions can be tested on their own: getting one wrong strands the reader
 * on a chat the list does not show.
 */
const THREAD_PARAM = "thread";

/** Search string with the thread dropped, preserving every other parameter. */
export function withoutThread(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(THREAD_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Search string for reading `chatId` within `rowId`.
 *
 * Selecting the row's own thread clears the parameter rather than restating
 * it, so the plain chat URL stays the canonical one and back/forward do not
 * step through two spellings of the same view.
 */
export function threadSearch(
  search: string,
  chatId: string,
  rowId: string | undefined,
): string {
  if (chatId === rowId) return withoutThread(search);
  const params = new URLSearchParams(search);
  params.set(THREAD_PARAM, chatId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The thread being read, or undefined when it is the row's own. */
export function activeThread(search: string): string | undefined {
  return new URLSearchParams(search).get(THREAD_PARAM) || undefined;
}
