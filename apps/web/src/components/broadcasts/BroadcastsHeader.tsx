import { ArrowLeft, Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  return (
    <header
      data-sk="page-header"
      className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6"
    >
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {showingDetail ? (
            <button
              type="button"
              onClick={onBack}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-fg-muted transition-colors hover:bg-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t(
                "broadcasts.backToBroadcasts",
                "Back to broadcasts",
              )}
            >
              <ArrowLeft
                className="h-4 w-4 rtl:-scale-x-100"
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Megaphone className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
          )}

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-none text-fg">
              {showingDetail
                ? t("broadcasts.details", "Broadcast details")
                : "Broadcasts"}
            </h1>
            <p className="mt-1 truncate text-xs text-fg-muted">
              {workspaceName} ·{" "}
              {showingDetail
                ? t(
                    "broadcasts.detailsSubtitle",
                    "delivery progress and recipient outcomes",
                  )
                : t(
                    "broadcasts.listSubtitle",
                    "scheduled outreach, paced safely by account",
                  )}
            </p>
          </div>
        </div>

        {!showingDetail && (
          <Button
            size="sm"
            onClick={onCreate}
            className="shrink-0 gap-2 bg-primary text-on-primary shadow-sm hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("broadcasts.newBroadcast", "New broadcast")}
            </span>
            <span className="sm:hidden">{t("broadcasts.new", "New")}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
