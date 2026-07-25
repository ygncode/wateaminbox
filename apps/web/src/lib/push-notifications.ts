import { getSafeNotificationPath } from "./notification-navigation";

export interface ParsedPushPayload {
  version: 1;
  type: "message" | "notification";
  title: string;
  body: string;
  tag: string;
  actionUrl: string;
}

export function parsePushPayload(value: unknown): ParsedPushPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const actionUrl = getSafeNotificationPath(payload.actionUrl);
  if (
    payload.version !== 1 ||
    (payload.type !== "message" && payload.type !== "notification") ||
    typeof payload.title !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.tag !== "string" ||
    !actionUrl
  )
    return null;
  return {
    version: 1,
    type: payload.type,
    title: payload.title.slice(0, 200),
    body: payload.body.slice(0, 500),
    tag: payload.tag.slice(0, 200),
    actionUrl,
  };
}
