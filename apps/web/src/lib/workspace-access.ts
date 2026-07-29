export type WorkspaceAccessMode = "required" | "setup" | "chooser";

export function isWorkspaceAccessBooting({
  isAuthenticated,
  userId,
  loadedUserId,
}: {
  isAuthenticated: boolean;
  userId: string | null;
  loadedUserId: string | null;
}): boolean {
  return isAuthenticated && userId !== null && loadedUserId !== userId;
}

export function resolveWorkspaceAccessRedirect({
  mode,
  membershipCount,
  activeWorkspaceId,
}: {
  mode: WorkspaceAccessMode;
  membershipCount: number;
  activeWorkspaceId: string | null;
}): string | null {
  if (mode === "setup") return null;
  if (membershipCount === 0) return "/company-setup";
  if (mode === "chooser") return null;
  if (!activeWorkspaceId) return "/workspaces";
  return null;
}
