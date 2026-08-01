import type { Context, Next } from "hono";
import { PERMISSIONS } from "../services/permission.service.js";
import { requirePermission } from "./permission.js";

/**
 * The canonical message-send endpoint accepts a tenant contact ID and resolves
 * the WhatsApp connection from that contact. JID/connection based endpoints
 * are retained only as explicit tombstones so old clients fail safely.
 */
export const CANONICAL_MESSAGE_SEND_PATH = "/api/messages";

export const MESSAGE_SEND_SURFACES = [
  "/messages",
  "/messages/scheduled",
  "/messages/:id/forward",
  "/messages/:id/retry",
  "/conversations/:id/messages",
  "/actions/messages/send",
  "/whatsapp/send",
  "/whatsapp/connections/:connectionId/send",
  "/bulk-jobs",
] as const;

/** A shared middleware instance makes the send policy auditable and testable. */
export const requireMessageSendPermission = requirePermission(
  PERMISSIONS.CAN_SEND_MESSAGES,
);

/**
 * Bulk broadcasts additionally require the dedicated bulk permission on top
 * of the plain send permission (both are attached to the bulk routes).
 */
export const requireBulkSendPermission = requirePermission(
  PERMISSIONS.CAN_SEND_BULK_MESSAGES,
);

/** Mark a still-functional compatibility route as deprecated. */
export async function markDeprecatedMessageSend(c: Context, next: Next) {
  c.header("Deprecation", "true");
  c.header(
    "Link",
    `<${CANONICAL_MESSAGE_SEND_PATH}>; rel=\"successor-version\"`,
  );
  await next();
}

/** Return a safe tombstone for JID-based legacy send routes. */
export function legacyMessageSendRemoved(c: Context) {
  c.header("Deprecation", "true");
  c.header(
    "Link",
    `<${CANONICAL_MESSAGE_SEND_PATH}>; rel=\"successor-version\"`,
  );
  return c.json(
    {
      error: "This message-send endpoint has been removed",
      replacement: CANONICAL_MESSAGE_SEND_PATH,
    },
    410,
  );
}
