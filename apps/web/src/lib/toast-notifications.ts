import type { ToastNotificationPayload } from "@wateaminbox/shared";
import { toast } from "sonner";
import { getSafeNotificationPath } from "./notification-navigation";

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
  const actionUrl = getSafeNotificationPath(payload.actionUrl);
  const actionLabel =
    typeof payload.actionLabel === "string"
      ? payload.actionLabel.trim().slice(0, 80)
      : "";
  return {
    ...(actionUrl && actionLabel ? { actionUrl, actionLabel } : {}),
    type: payload.type as ToastNotificationPayload["type"],
    title: payload.title.slice(0, 200),
    message: payload.message.slice(0, 500),
    ...(payload.connectionId ? { connectionId: payload.connectionId } : {}),
  };
}

export function getRealtimeToastOptions(
  payload: ToastNotificationPayload,
  navigate?: (path: string) => void,
) {
  const actionUrl = getSafeNotificationPath(payload.actionUrl);
  return {
    ...(actionUrl && payload.actionLabel && navigate
      ? {
          action: {
            label: payload.actionLabel,
            onClick: () => navigate(actionUrl),
          },
          duration: 10_000,
        }
      : {}),
    description: payload.message,
    id: payload.connectionId
      ? `notification-toast-${payload.connectionId}-${payload.type}-${payload.title}`
      : undefined,
  };
}

export function showRealtimeToast(
  value: unknown,
  navigate?: (path: string) => void,
): boolean {
  const payload = parseToastNotificationPayload(value);
  if (!payload) return false;
  toast[payload.type](
    payload.title,
    getRealtimeToastOptions(payload, navigate),
  );
  return true;
}
