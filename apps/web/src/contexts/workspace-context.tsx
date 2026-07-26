import { useQueryClient } from "@tanstack/react-query";
import type { CompanyWithRole, MemberPermissions } from "@wateaminbox/shared";
import * as React from "react";
import {
  clearCompanyId,
  getCompanyId,
  getUserCompanies,
  setCompanyId,
  unsubscribeAllPush,
} from "../lib/api";
import { resolveInitialWorkspaceId } from "../lib/workspace-routes";
import { useChatStore } from "../stores/chat-store";
import { useAuth } from "./auth-context";

export type WorkspaceCapability = keyof MemberPermissions;

export interface WorkspaceContextValue {
  memberships: CompanyWithRole[];
  activeWorkspace: CompanyWithRole | null;
  activeWorkspaceId: string | null;
  isLoading: boolean;
  isSwitching: boolean;
  switchingTo: CompanyWithRole | null;
  error: string | null;
  needsWorkspaceSetup: boolean;
  needsWorkspaceChoice: boolean;
  switchWorkspace: (workspaceId: string) => Promise<CompanyWithRole>;
  refreshWorkspaces: () => Promise<CompanyWithRole[]>;
  can: (capability: WorkspaceCapability) => boolean;
  canAny: (capabilities: WorkspaceCapability[]) => boolean;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | undefined>(
  undefined,
);

function preferenceKey(userId: string): string {
  return `wateaminbox:last-workspace:${userId}`;
}

function getRouteWorkspaceId(pathname: string): string | null {
  const match = pathname.match(/^\/w\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function queryKeyContains(
  queryKey: readonly unknown[],
  value: string,
): boolean {
  return queryKey.some((part) => {
    if (part === value) return true;
    if (Array.isArray(part)) return queryKeyContains(part, value);
    if (part && typeof part === "object") {
      return Object.values(part).some((entry) => entry === value);
    }
    return false;
  });
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [memberships, setMemberships] = React.useState<CompanyWithRole[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<
    string | null
  >(null);
  const activeWorkspaceIdRef = React.useRef<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadedUserId, setLoadedUserId] = React.useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = React.useState<CompanyWithRole | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const resolveInitialWorkspace = React.useCallback(
    (available: CompanyWithRole[]): string | null => {
      if (!user) return null;
      const routeWorkspaceId = getRouteWorkspaceId(window.location.pathname);
      let preferredWorkspaceId: string | null = null;
      try {
        preferredWorkspaceId = localStorage.getItem(preferenceKey(user.id));
      } catch {
        // Storage can be unavailable in privacy-restricted environments.
      }

      // Migrate the former global preference once, then persist it per user.
      return resolveInitialWorkspaceId(
        available
          .filter((workspace) => workspace.status === "active")
          .map((workspace) => workspace.id),
        routeWorkspaceId,
        preferredWorkspaceId,
        getCompanyId(),
      );
    },
    [user],
  );

  React.useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const refreshWorkspaces = React.useCallback(async () => {
    if (!isAuthenticated || !user) {
      setMemberships([]);
      activeWorkspaceIdRef.current = null;
      setActiveWorkspaceId(null);
      setLoadedUserId(null);
      clearCompanyId();
      return [];
    }

    setIsLoading(true);
    setError(null);
    try {
      const available = await getUserCompanies();
      const currentId = activeWorkspaceIdRef.current;
      const currentIsValid = available.some(
        (workspace) =>
          workspace.id === currentId && workspace.status === "active",
      );
      const resolved = currentIsValid
        ? currentId
        : resolveInitialWorkspace(available);

      if (currentId && resolved !== currentId) {
        await queryClient.cancelQueries({
          predicate: (query) => queryKeyContains(query.queryKey, currentId),
        });
        await unsubscribeAllPush().catch(() => undefined);
        useChatStore.getState().reset();
        queryClient.removeQueries({
          predicate: (query) => queryKeyContains(query.queryKey, currentId),
        });
      }

      setMemberships(available);
      setLoadedUserId(user.id);
      activeWorkspaceIdRef.current = resolved;
      setActiveWorkspaceId(resolved);
      if (resolved) {
        setCompanyId(resolved);
        try {
          localStorage.setItem(preferenceKey(user.id), resolved);
        } catch {
          // Ignore storage failures; the in-memory selection still works.
        }
      } else {
        clearCompanyId();
      }
      return available;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to load workspaces";
      setLoadedUserId(user.id);
      setError(message);
      throw cause;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, queryClient, resolveInitialWorkspace, user]);

  React.useEffect(() => {
    if (!isAuthenticated || !user) {
      setMemberships([]);
      activeWorkspaceIdRef.current = null;
      setActiveWorkspaceId(null);
      setLoadedUserId(null);
      setError(null);
      return;
    }
    void refreshWorkspaces().catch(() => undefined);
    const refreshOnFocus = () =>
      void refreshWorkspaces().catch(() => undefined);
    window.addEventListener("focus", refreshOnFocus);
    const interval = window.setInterval(refreshOnFocus, 5 * 60_000);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.clearInterval(interval);
    };
  }, [isAuthenticated, refreshWorkspaces, user]);

  const switchWorkspace = React.useCallback(
    async (workspaceId: string) => {
      let target = memberships.find(
        (workspace) => workspace.id === workspaceId,
      );
      if (!target) {
        const available = await getUserCompanies();
        setMemberships(available);
        target = available.find((workspace) => workspace.id === workspaceId);
      }
      if (!target) throw new Error("You do not have access to this workspace");
      if (target.status !== "active")
        throw new Error("This workspace is unavailable");
      if (!user) throw new Error("You must be signed in to switch workspaces");
      if (target.id === activeWorkspaceId) return target;

      const previousId = activeWorkspaceId;
      setSwitchingTo(target);
      setError(null);
      try {
        await queryClient.cancelQueries({
          predicate: (query) =>
            previousId !== null && queryKeyContains(query.queryKey, previousId),
        });
        await unsubscribeAllPush().catch(() => undefined);
        useChatStore.getState().reset();

        setCompanyId(target.id);
        activeWorkspaceIdRef.current = target.id;
        setActiveWorkspaceId(target.id);
        try {
          localStorage.setItem(preferenceKey(user.id), target.id);
        } catch {
          // Ignore storage failures.
        }

        if (previousId) {
          queryClient.removeQueries({
            predicate: (query) => queryKeyContains(query.queryKey, previousId),
          });
        }

        const verifiedMemberships = await getUserCompanies();
        const verifiedTarget = verifiedMemberships.find(
          (workspace) => workspace.id === target.id,
        );
        if (!verifiedTarget || verifiedTarget.status !== "active") {
          throw new Error("This workspace is no longer available");
        }
        setMemberships(verifiedMemberships);
        return verifiedTarget;
      } catch (cause) {
        if (previousId) setCompanyId(previousId);
        else clearCompanyId();
        activeWorkspaceIdRef.current = previousId;
        setActiveWorkspaceId(previousId);
        const message =
          cause instanceof Error ? cause.message : "Workspace switch failed";
        setError(message);
        throw cause;
      } finally {
        setSwitchingTo(null);
      }
    },
    [activeWorkspaceId, memberships, queryClient, user],
  );

  const activeWorkspace =
    memberships.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const can = React.useCallback(
    (capability: WorkspaceCapability) =>
      Boolean(activeWorkspace?.permissions[capability]),
    [activeWorkspace],
  );
  const canAny = React.useCallback(
    (capabilities: WorkspaceCapability[]) => capabilities.some(can),
    [can],
  );

  const workspaceIsLoading =
    isLoading || (isAuthenticated && loadedUserId !== user?.id);

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      memberships,
      activeWorkspace,
      activeWorkspaceId,
      isLoading: workspaceIsLoading,
      isSwitching: switchingTo !== null,
      switchingTo,
      error,
      needsWorkspaceSetup:
        !workspaceIsLoading && !error && memberships.length === 0,
      needsWorkspaceChoice:
        !workspaceIsLoading && memberships.length > 1 && !activeWorkspaceId,
      switchWorkspace,
      refreshWorkspaces,
      can,
      canAny,
    }),
    [
      memberships,
      activeWorkspace,
      activeWorkspaceId,
      workspaceIsLoading,
      switchingTo,
      error,
      switchWorkspace,
      refreshWorkspaces,
      can,
      canAny,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = React.useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

export function useHasRole(
  allowedRoles: Array<CompanyWithRole["role"]>,
): boolean {
  const { activeWorkspace } = useWorkspace();
  return activeWorkspace ? allowedRoles.includes(activeWorkspace.role) : false;
}

export function useIsAdmin(): boolean {
  return useHasRole(["owner", "admin"]);
}
