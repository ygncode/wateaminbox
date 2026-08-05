/**
 * Query-string shaping for the notification list endpoint.
 *
 * Kept separate from the request functions so the serialization contract can be
 * asserted directly.
 */

import type { NotificationListParams } from "./types.js";

/**
 * Normalizes list params for the wire.
 *
 * `unreadOnly` is a filter, not a tri-state: when it is off the parameter is
 * omitted entirely rather than sent as `unreadOnly=false`. That keeps "show
 * everything" the literal absence of a filter, so a read notification can never
 * be dropped by a server that reads the flag loosely.
 */
export function buildNotificationListQuery(
  params: NotificationListParams = {},
): Record<string, unknown> {
  const { unreadOnly, ...rest } = params;
  const query: Record<string, unknown> = { ...rest };
  if (unreadOnly) query.unreadOnly = true;
  return query;
}
