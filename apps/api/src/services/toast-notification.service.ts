import type { ToastNotificationPayload } from "@wateaminbox/shared";

/** Convert untrusted worker error shapes into the only toast payload clients accept. */
export function normalizeWorkerErrorToast(
  payload: unknown,
  connectionId?: string,
): ToastNotificationPayload {
  const value =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const message = [value.message, value.error, value.reason].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return {
    type: "error",
    title: "WhatsApp action failed",
    message: message?.slice(0, 500) ?? "The WhatsApp worker reported an error.",
    ...(connectionId ? { connectionId } : {}),
  };
}
