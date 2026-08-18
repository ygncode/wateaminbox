import type { ProductAnalyticsEventName } from "./types";

/**
 * Runtime allowlist mirroring the ProductAnalyticsEvents type. TypeScript
 * alone cannot protect future JavaScript callers or dynamically assembled
 * values, so every event is re-validated here: unknown names are rejected,
 * unknown parameters are dropped, and values must match a predefined enum.
 */
const EVENT_CONTRACT: Record<
  ProductAnalyticsEventName,
  Readonly<Record<string, readonly string[]>>
> = {
  login: { method: ["email"] },
  sign_up: { method: ["email"] },
  workspace_created: {},
  whatsapp_connection_setup_started: {},
  whatsapp_connection_connected: { connectionMode: ["new", "reconnect"] },
  message_sent: {
    messageType: ["text", "image", "video", "audio", "document", "other"],
  },
  conversation_resolved: {},
  teammate_invited: { role: ["admin", "member"] },
  quick_reply_used: {},
  broadcast_created: {
    delivery: ["immediate", "scheduled"],
    recipientBucket: ["1-10", "11-50", "51-100", "100+"],
  },
  report_exported: {
    report: ["dashboard", "audit", "contacts", "other"],
    format: ["csv", "json", "other"],
  },
};

export interface SanitizedEvent {
  name: ProductAnalyticsEventName;
  params: Record<string, string>;
}

/**
 * Returns the event with only allowlisted parameters, or null when the event
 * name is unknown or a declared parameter is missing/out of range (a partial
 * event would be misleading in reports, so it is dropped entirely).
 */
export function sanitizeEvent(
  name: string,
  params: unknown,
): SanitizedEvent | null {
  if (!Object.prototype.hasOwnProperty.call(EVENT_CONTRACT, name)) return null;
  const eventName = name as ProductAnalyticsEventName;
  const contract = EVENT_CONTRACT[eventName];
  const input =
    params && typeof params === "object"
      ? (params as Record<string, unknown>)
      : {};

  const sanitized: Record<string, string> = {};
  for (const [key, allowedValues] of Object.entries(contract)) {
    const value = input[key];
    if (typeof value !== "string" || !allowedValues.includes(value)) {
      return null;
    }
    sanitized[key] = value;
  }
  return { name: eventName, params: sanitized };
}

/** Coarse recipient buckets so broadcast sizes are never reported exactly. */
export function bucketRecipientCount(
  count: number,
): "1-10" | "11-50" | "51-100" | "100+" {
  if (!Number.isFinite(count) || count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 100) return "51-100";
  return "100+";
}
