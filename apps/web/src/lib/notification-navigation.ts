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
