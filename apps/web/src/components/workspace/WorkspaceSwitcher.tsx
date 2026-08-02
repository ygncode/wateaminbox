import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import * as React from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useWorkspace } from "../../contexts/workspace-context";
import { useCreateCompany } from "../../hooks/useTeam";
import { cn } from "../../lib/utils";
import { resolveWorkspaceDestination } from "../../lib/workspace-routes";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
export { workspaceMonogram } from "./WorkspaceAvatar";

function roleLabel(role: "owner" | "admin" | "member") {
  return role === "admin"
    ? "Administrator"
    : `${role[0].toUpperCase()}${role.slice(1)}`;
}

export function WorkspaceSwitcher({
  compact = false,
  collapsed = false,
}: {
  compact?: boolean;
  collapsed?: boolean;
}) {
  const {
    memberships,
    activeWorkspace,
    isSwitching,
    switchingTo,
    switchWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const createWorkspace = useCreateCompany();
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("");

  const visibleMemberships = memberships.filter((workspace) =>
    workspace.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  const handleSwitch = async (workspaceId: string) => {
    if (workspaceId === activeWorkspace?.id) {
      setOpen(false);
      return;
    }
    const target = memberships.find(
      (workspace) => workspace.id === workspaceId,
    );
    if (!target) return;
    setOpen(false);
    try {
      const membership = await switchWorkspace(workspaceId);
      const destination = resolveWorkspaceDestination(
        workspaceId,
        location.pathname,
        membership.permissions,
      );
      navigate(destination.path);
      toast.success(`Switched to ${membership.name}`);
      if (destination.wasRedirected) {
        toast.info(
          "This workspace opened in Inbox because the previous view is unavailable.",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not switch workspace",
      );
    }
  };

  const handleCreate = () => {
    const name = workspaceName.trim();
    if (!name) return;
    createWorkspace.mutate(
      { name },
      {
        onSuccess: async (created) => {
          const refreshed = await refreshWorkspaces();
          const membership = refreshed.find((item) => item.id === created.id);
          if (membership) {
            await switchWorkspace(membership.id);
            navigate(
              resolveWorkspaceDestination(
                membership.id,
                location.pathname,
                membership.permissions,
              ).path,
            );
          }
          setWorkspaceName("");
          setCreateOpen(false);
          toast.success(`${created.name} is ready`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  if (!activeWorkspace) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isSwitching}
            className={cn(
              "group relative flex items-center rounded-xl text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-300",
              collapsed
                ? "h-11 w-full justify-center p-1 hover:bg-white/10"
                : compact
                  ? "h-10 max-w-[210px] gap-2 px-2 hover:bg-white/10"
                  : "w-full gap-3 border border-white/10 bg-white/[0.06] p-2.5 hover:bg-white/10",
            )}
            aria-label={`Active workspace: ${activeWorkspace.name}. Switch workspace`}
            title={collapsed ? `Workspace: ${activeWorkspace.name}` : undefined}
          >
            <WorkspaceAvatar
              workspace={activeWorkspace}
              className="h-9 w-9 rounded-lg text-xs tracking-wide"
            />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {isSwitching
                    ? `Switching to ${switchingTo?.name}…`
                    : activeWorkspace.name}
                </span>
                <span className="block truncate text-[11px] text-[#a7bbb3]">
                  {roleLabel(activeWorkspace.role)}
                </span>
              </span>
            )}
            {isSwitching ? (
              <Loader2
                className={cn(
                  "h-4 w-4 shrink-0 animate-spin text-emerald-300",
                  collapsed && "absolute bottom-0.5 right-0.5",
                )}
              />
            ) : (
              !collapsed && (
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-[#8ba29a]" />
              )
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border-[#dce3de] p-2 shadow-2xl dark:border-dark-border"
        >
          <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#65736d]">
              Switch workspace
            </p>
          </div>
          {memberships.length >= 4 && (
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a workspace"
                className="h-9 rounded-lg pl-9"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {visibleMemberships.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => void handleSwitch(workspace.id)}
                disabled={workspace.status !== "active"}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[#edf1ed] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-tertiary"
              >
                <WorkspaceAvatar
                  workspace={workspace}
                  className="h-9 w-9 rounded-lg bg-[#edf1ed] text-xs text-[#315348] dark:bg-dark-tertiary dark:text-emerald-200"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {workspace.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    {roleLabel(workspace.role)}
                    {workspace.status !== "active" && " · Suspended"}
                  </span>
                </span>
                {workspace.id === activeWorkspace.id && (
                  <Check
                    className="h-4 w-4 text-[#0b7a55]"
                    aria-label="Active"
                  />
                )}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-[#dce3de] pt-2 dark:border-dark-border">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#0b7a55] hover:bg-[#dcefe7] dark:text-emerald-300 dark:hover:bg-emerald-400/10"
            >
              <Plus className="h-4 w-4" />
              Create workspace
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 w-[calc(100vw-2rem)] rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>Create another workspace</DialogTitle>
            <DialogDescription>
              Start a separate inbox with its own team, connections, and data.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm font-medium">
            Workspace name
            <Input
              autoFocus
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreate();
              }}
              placeholder="Northwind Support"
              maxLength={100}
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!workspaceName.trim() || createWorkspace.isPending}
              className="bg-[#0b7a55] text-white hover:bg-[#096747]"
            >
              {createWorkspace.isPending ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
