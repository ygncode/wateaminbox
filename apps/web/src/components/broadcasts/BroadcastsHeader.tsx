import { ArrowLeft, Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BroadcastsHeaderProps {
  workspaceName: string;
  showingDetail: boolean;
  onBack: () => void;
  onCreate: () => void;
}

/** Workspace-page toolbar aligned with Dashboard, Team, and Audit headers. */
export function BroadcastsHeader({
  workspaceName,
  showingDetail,
  onBack,
  onCreate,
}: BroadcastsHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {showingDetail ? (
            <button
              type="button"
              onClick={onBack}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#d7e0da] bg-white text-[#52675f] transition-colors hover:bg-[#edf2ef] hover:text-[#075c41] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-secondary dark:hover:bg-dark-tertiary dark:hover:text-emerald-300"
              aria-label="Back to broadcasts"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
              <Megaphone className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
          )}

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-none text-gray-900 dark:text-dark-text-primary">
              {showingDetail ? "Broadcast details" : "Broadcasts"}
            </h1>
            <p className="mt-1 truncate text-xs text-[#65736d] dark:text-dark-text-secondary">
              {workspaceName} ·{" "}
              {showingDetail
                ? "delivery progress and recipient outcomes"
                : "scheduled outreach, paced safely by account"}
            </p>
          </div>
        </div>

        {!showingDetail && (
          <Button
            size="sm"
            onClick={onCreate}
            className="shrink-0 gap-2 bg-[#0b7a55] text-white shadow-sm hover:bg-[#096747]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">New broadcast</span>
            <span className="sm:hidden">New</span>
          </Button>
        )}
      </div>
    </header>
  );
}
