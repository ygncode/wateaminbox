/**
 * The inbox list is merged from two independent sources: WhatsApp contacts
 * (`/contacts`) and channel conversations such as Telegram (`/conversations`).
 * Each answers on its own schedule, and the channel list is usually faster.
 *
 * Rendering whichever source answered first showed a Telegram-only inbox that
 * then reshuffled when the WhatsApp page arrived and the merged list re-sorted.
 * Instead, hold the skeleton until every source has settled its first page
 * (loaded or failed), so the list appears once, complete and correctly sorted.
 *
 * A source that is merely slow must not blank the inbox indefinitely, so after
 * a short grace period the rows that have arrived are shown anyway.
 */
export const PARTIAL_INBOX_GRACE_MS = 2_000;

export function shouldHoldInboxList({
  anySourceLoading,
  hasRows,
  graceElapsed,
}: {
  /** At least one source has no data yet and is fetching its first page. */
  anySourceLoading: boolean;
  /** The sources that did answer produced rows to show. */
  hasRows: boolean;
  /** The partial-list grace period has passed for this load. */
  graceElapsed: boolean;
}): boolean {
  if (!anySourceLoading) return false;
  return !(hasRows && graceElapsed);
}
