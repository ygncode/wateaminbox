import type { MemberPermissions } from "@wateaminbox/shared";

export function resolveInitialWorkspaceId(
  availableWorkspaceIds: string[],
  routeWorkspaceId: string | null,
  preferredWorkspaceId: string | null,
  legacyWorkspaceId: string | null = null,
): string | null {
  for (const candidate of [
    routeWorkspaceId,
    preferredWorkspaceId,
    legacyWorkspaceId,
  ]) {
    if (candidate && availableWorkspaceIds.includes(candidate))
      return candidate;
  }
  return availableWorkspaceIds.length === 1 ? availableWorkspaceIds[0] : null;
}

export type WorkspaceDestination =
  | "chat"
  | "dashboard"
  | "team"
  | "audit"
  | "settings"
  | "notifications";

export function workspacePath(
  workspaceId: string,
  destination: WorkspaceDestination = "chat",
  suffix?: string,
): string {
  const encodedId = encodeURIComponent(workspaceId);
  if (destination === "settings") {
    const base = `/w/${encodedId}/settings`;
    return suffix ? `${base}/${encodeURIComponent(suffix)}` : base;
  }
  const base = `/w/${encodedId}/${destination}`;
  return suffix ? `${base}/${encodeURIComponent(suffix)}` : base;
}

export function getWorkspaceDestination(pathname: string): {
  destination: WorkspaceDestination;
  suffix?: string;
} {
  const parts = pathname.split("/").filter(Boolean);
  const isCanonical = parts[0] === "w";
  const destination = (isCanonical ? parts[2] : parts[0]) as
    | WorkspaceDestination
    | undefined;
  if (
    destination &&
    [
      "chat",
      "dashboard",
      "team",
      "audit",
      "settings",
      "notifications",
    ].includes(destination)
  ) {
    return {
      destination,
      suffix: isCanonical ? parts[3] : parts[1],
    };
  }
  return { destination: "chat" };
}

export function isDestinationAllowed(
  destination: WorkspaceDestination,
  permissions: MemberPermissions,
): boolean {
  switch (destination) {
    case "dashboard":
      return permissions.can_view_dashboard;
    case "team":
      return permissions.can_manage_team || permissions.can_invite;
    case "audit":
      return permissions.can_view_audit;
    default:
      return true;
  }
}

export function resolveWorkspaceDestination(
  workspaceId: string,
  pathname: string,
  permissions: MemberPermissions,
): { path: string; wasRedirected: boolean } {
  const { destination, suffix } = getWorkspaceDestination(pathname);
  // Conversations are never carried across tenants.
  if (destination === "chat") {
    return {
      path: workspacePath(workspaceId, "chat"),
      wasRedirected: Boolean(suffix),
    };
  }
  if (!isDestinationAllowed(destination, permissions)) {
    return { path: workspacePath(workspaceId, "chat"), wasRedirected: true };
  }
  return {
    path: workspacePath(workspaceId, destination, suffix),
    wasRedirected: false,
  };
}
