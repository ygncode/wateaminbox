import { ArrowRight, Building2, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { workspaceMonogram } from "../components/workspace/WorkspaceSwitcher";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { workspacePath } from "../lib/workspace-routes";

export function WorkspaceChooserPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { memberships, switchWorkspace, isSwitching, switchingTo } =
    useWorkspace();

  const choose = async (workspaceId: string) => {
    try {
      await switchWorkspace(workspaceId);
      navigate(workspacePath(workspaceId), { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open workspace",
      );
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f5f7f4] px-5 py-10 text-[#10211b] dark:bg-dark-primary dark:text-dark-text-primary">
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#dcefe7] blur-3xl dark:bg-emerald-500/10" />
      <div className="relative mx-auto max-w-2xl">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#102c24] text-white">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              WATeamInbox
            </span>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#65736d] hover:bg-white hover:text-[#10211b] dark:hover:bg-dark-tertiary dark:hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0b7a55]">
          Your workspaces
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          Where are you working today?
        </h1>
        <p className="mt-3 max-w-lg text-[#65736d] dark:text-dark-text-secondary">
          Each workspace keeps its conversations, team, and settings separate.
        </p>

        <div className="mt-8 grid gap-3">
          {memberships.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              disabled={isSwitching || workspace.status !== "active"}
              onClick={() => void choose(workspace.id)}
              className="group flex items-center gap-4 rounded-2xl border border-[#dce3de] bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,33,27,.03)] transition-all hover:-translate-y-0.5 hover:border-[#9bcab8] hover:shadow-[0_12px_30px_rgba(16,33,27,.08)] disabled:opacity-60 dark:border-dark-border dark:bg-dark-elevated"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-sm font-bold text-[#075c41]">
                {workspaceMonogram(workspace.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {switchingTo?.id === workspace.id
                    ? `Opening ${workspace.name}…`
                    : workspace.name}
                </span>
                <span className="mt-0.5 block text-sm capitalize text-[#65736d] dark:text-dark-text-secondary">
                  {workspace.role}
                  {workspace.status !== "active" && " · suspended"}
                </span>
              </span>
              <ArrowRight className="h-5 w-5 text-[#9aaba4] transition-transform group-hover:translate-x-1 group-hover:text-[#0b7a55]" />
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
