import type { ToastNotificationPayload } from "@wateaminbox/shared";
import { toast } from "sonner";

const TOAST_TYPES = new Set(["success", "error", "warning", "info"]);

export function parseToastNotificationPayload(
  value: unknown,
): ToastNotificationPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.type !== "string" ||
    !TOAST_TYPES.has(payload.type) ||
    typeof payload.title !== "string" ||
    !payload.title.trim() ||
    typeof payload.message !== "string" ||
    !payload.message.trim() ||
    (payload.connectionId !== undefined &&
      typeof payload.connectionId !== "string")
  )
    return null;
  return {
    type: payload.type as ToastNotificationPayload["type"],
    title: payload.title.slice(0, 200),
    message: payload.message.slice(0, 500),
    ...(payload.connectionId ? { connectionId: payload.connectionId } : {}),
  };
}

export function showRealtimeToast(value: unknown): boolean {
  const payload = parseToastNotificationPayload(value);
  if (!payload) return false;
  const options = {
    description: payload.message,
    id: payload.connectionId
      ? `notification-toast-${payload.connectionId}-${payload.type}-${payload.title}`
      : undefined,
  };
  toast[payload.type](payload.title, options);
  return true;
}
