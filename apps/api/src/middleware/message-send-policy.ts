import type { Context, Next } from "hono";
import { PERMISSIONS } from "../services/permission.service.js";
import { requirePermission } from "./permission.js";

/**
 * The canonical message-send endpoint accepts a tenant contact ID and resolves
 * the WhatsApp connection from that contact.
 */
export const CANONICAL_MESSAGE_SEND_PATH = "/api/messages";

export const MESSAGE_SEND_SURFACES = [
  "/messages",
  "/messages/scheduled",
  "/messages/:id/forward",
  "/messages/:id/retry",
  "/conversations/:id/messages",
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
