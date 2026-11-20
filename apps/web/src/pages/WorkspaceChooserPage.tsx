import { ArrowRight, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { BrandMark } from "../components/brand/BrandMark";
import { WorkspaceAvatar } from "../components/workspace/WorkspaceAvatar";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { workspacePath } from "../lib/workspace-routes";
import { useTranslation } from "react-i18next";

export function WorkspaceChooserPage() {
  const { t } = useTranslation();

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
        error instanceof Error
          ? error.message
          : t("workspaces.openFailed", "Could not open workspace"),
      );
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-subtle px-5 py-10 text-fg">
      <div className="relative mx-auto max-w-2xl">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 shrink-0 rounded-xl object-contain" />
            <span className="text-sm font-semibold tracking-tight">
              WATeamInbox
            </span>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface hover:text-fg"
          >
            <LogOut className="h-4 w-4" /> {t("nav.signOut")}
          </button>
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
          {t("workspaces.yourWorkspaces", "Your workspaces")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {t("workspaces.whereWorking", "Where are you working today?")}
        </h1>
        <p className="mt-3 max-w-lg text-fg-muted">
          {t(
            "workspaces.separateHint",
            "Each workspace keeps its conversations, team, and settings separate.",
          )}
        </p>

        <div className="mt-8 grid gap-3">
          {memberships.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              disabled={isSwitching || workspace.status !== "active"}
              onClick={() => void choose(workspace.id)}
              className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-start shadow-xs transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-lg disabled:opacity-60"
            >
              <WorkspaceAvatar
                workspace={workspace}
                className="h-12 w-12 rounded-xl text-sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {switchingTo?.id === workspace.id
                    ? t("workspaces.opening", { name: workspace.name })
                    : workspace.name}
                </span>
                <span className="mt-0.5 block text-sm capitalize text-fg-muted">
                  {workspace.role}
                  {workspace.status !== "active" && " · suspended"}
                </span>
              </span>
              <ArrowRight className="h-5 w-5 text-fg-subtle transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 group-hover:text-accent rtl:-scale-x-100" />
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
