import { threadSearch } from "../hooks/chat/chat-thread-param";
import { getWorkspaceDestination, workspacePath } from "./workspace-routes";

export function getSafeNotificationPath(value: unknown): string | null {
  if (typeof value !== "string" || !/^\/(?!\/)/.test(value)) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return value;
}

export function navigateToNotificationTarget(
  value: unknown,
  navigate: (path: string) => void,
  workspaceId?: string | null,
): boolean {
  const path = getSafeNotificationPath(value);
  if (!path) return false;
  if (
    workspaceId &&
    /^\/(chat|dashboard|team|audit|settings|notifications)(?:\/|$)/.test(path)
  ) {
    const { destination, suffix } = getWorkspaceDestination(path);
    navigate(workspacePath(workspaceId, destination, suffix));
  } else {
    navigate(path);
  }
  return true;
}

/**
 * Where a message alert leads: the inbox row, plus `?thread=` when the message
 * arrived on another of that customer's threads. Built in the workspace route
 * directly so the thread survives - the legacy `/chat/...` redirect keeps only
 * the path.
 */
export function chatNotificationPath(
  workspaceId: string | null | undefined,
  chatId: string,
  thread?: string,
): string {
  const base = workspaceId
    ? workspacePath(workspaceId, "chat", chatId)
    : `/chat/${encodeURIComponent(chatId)}`;
  return `${base}${thread ? threadSearch("", thread, chatId) : ""}`;
}
