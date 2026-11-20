import { getDateRange, toISOString } from "@wateaminbox/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ExportDialog } from "@/components/export";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useContactStats,
  useDashboardStats,
  useHourlyStats,
  useMessageStats,
  useMessageTypeStats,
  useNewContactsTrend,
  useTeamActivityStats,
} from "@/hooks/analytics";
import { CustomerEngagementSection } from "./CustomerEngagementSection";
import { StatsCardsRow, TrendChartsRow } from "./DashboardCharts";
import {
  DashboardHeader,
  type DateRange,
  type ExportType,
} from "./DashboardHeader";
import { DashboardStats } from "./DashboardStats";
import { ResolutionRateSection } from "./ResolutionRateSection";
import { ResponseTimeAnalytics } from "./ResponseTimeAnalytics";

export interface DashboardProps {
  companyId: string;
  isAdmin?: boolean;
  canExport?: boolean;
  workspaceName: string;
}

/**
 * Analytics Dashboard component
 */
export function Dashboard({
  companyId,
  isAdmin = false,
  canExport = false,
  workspaceName,
}: DashboardProps) {
  const { t } = useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();
  const rangeParam = searchParams.get("range");
  const dateRange: DateRange =
    rangeParam === "7d" || rangeParam === "90d" ? rangeParam : "30d";
  const setDateRange = (range: DateRange) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("range", range);
      return next;
    });
  };
  const [exportType, setExportType] = useState<ExportType | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const secondarySentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSecondary || !secondarySentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setShowSecondary(true),
      { rootMargin: "0px" },
    );
    observer.observe(secondarySentinelRef.current);
    return () => observer.disconnect();
  }, [showSecondary]);

  const { startDate, endDate } = useMemo(() => {
    const { start, end } = getDateRange(dateRange);
    return { startDate: toISOString(start), endDate: toISOString(end) };
  }, [dateRange]);

  // Data fetching hooks
  const {
    data: dashboardStats,
    isLoading: isLoadingDashboard,
    isError: isDashboardError,
  } = useDashboardStats(companyId);
  const {
    data: messageData,
    isLoading: isLoadingMessages,
    isError: isMessagesError,
  } = useMessageStats(companyId, startDate, endDate);
  const {
    data: contactStats,
    isLoading: isLoadingContacts,
    isError: isContactsError,
  } = useContactStats(showSecondary ? companyId : null);
  const {
    data: messageTypes,
    isLoading: isLoadingTypes,
    isError: isTypesError,
  } = useMessageTypeStats(showSecondary ? companyId : null, startDate, endDate);
  const {
    data: hourlyStats,
    isLoading: isLoadingHourly,
    isError: isHourlyError,
  } = useHourlyStats(
    companyId,
    dateRange === "7d" ? 7 : dateRange === "90d" ? 90 : 30,
  );
  const {
    data: teamStats,
    isLoading: isLoadingTeam,
    isError: isTeamError,
  } = useTeamActivityStats(showSecondary && isAdmin ? companyId : null);
  const {
    data: contactsTrendData,
    isLoading: isLoadingContactsTrend,
    isError: isContactsTrendError,
  } = useNewContactsTrend(companyId, startDate, endDate);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-subtle">
      <DashboardHeader
        workspaceName={workspaceName}
        dateRange={dateRange}
        canExport={canExport}
        onDateRangeChange={setDateRange}
        onExport={setExportType}
      />

      {exportType && (
        <ExportDialog
          open={!!exportType}
          onOpenChange={(open) => !open && setExportType(null)}
          type={exportType}
        />
      )}

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <ScrollArea className="h-full rounded-xl border border-line bg-subtle shadow-sm">
          <div className="space-y-6 p-4 sm:p-5 lg:p-6">
            <section aria-labelledby="operational-overview-title">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2
                    id="operational-overview-title"
                    className="text-sm font-semibold text-fg"
                  >
                    {t("dashboard.operationalOverview", "Operational overview")}
                  </h2>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {t(
                      "dashboard.operationalOverviewHint",
                      "A live pulse of messaging and workspace activity.",
                    )}
                  </p>
                </div>
                <span className="rounded-full border border-line bg-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {t("dashboard.allTime", "All time")}
                </span>
              </div>
              <DashboardStats
                data={dashboardStats}
                isLoading={isLoadingDashboard}
                isError={isDashboardError}
              />
            </section>

            <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  {t("dashboard.activityTrends", "Activity trends")}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {t(
                    "dashboard.activityTrendsHint",
                    "Volume, acquisition, and traffic patterns.",
                  )}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                Last{" "}
                {dateRange === "7d" ? "7" : dateRange === "90d" ? "90" : "30"}{" "}
                days
              </span>
            </div>

            <TrendChartsRow
              messageData={messageData}
              isLoadingMessages={isLoadingMessages}
              isMessagesError={isMessagesError}
              contactsTrendData={contactsTrendData}
              isLoadingContactsTrend={isLoadingContactsTrend}
              isContactsTrendError={isContactsTrendError}
              hourlyStats={hourlyStats}
              isLoadingHourly={isLoadingHourly}
              isHourlyError={isHourlyError}
            />

            <div
              ref={secondarySentinelRef}
              className="h-px"
              aria-hidden="true"
            />
            {showSecondary ? (
              <>
                <div className="border-t border-line pt-6">
                  <h2 className="text-sm font-semibold text-fg">
                    {t("dashboard.workspaceInsights", "Workspace insights")}
                  </h2>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {t(
                      "dashboard.workspaceInsightsHint",
                      "Deeper signals for contact quality, outcomes, and service performance.",
                    )}
                  </p>
                </div>
                <StatsCardsRow
                  contactStats={contactStats}
                  isLoadingContacts={isLoadingContacts}
                  isContactsError={isContactsError}
                  messageTypes={messageTypes}
                  isLoadingTypes={isLoadingTypes}
                  isTypesError={isTypesError}
                  teamStats={teamStats}
                  isLoadingTeam={isLoadingTeam}
                  isTeamError={isTeamError}
                  isAdmin={isAdmin}
                />
                <ResolutionRateSection
                  companyId={companyId}
                  dateRange={dateRange}
                  isAdmin={isAdmin}
                />
                <CustomerEngagementSection
                  companyId={companyId}
                  startDate={startDate}
                  endDate={endDate}
                />
                <div className="rounded-xl border border-line bg-surface p-5 shadow-xs">
                  <ResponseTimeAnalytics
                    companyId={companyId}
                    dateRange={dateRange}
                    isAdmin={isAdmin}
                  />
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowSecondary(true)}
                className="w-full rounded-xl border border-dashed border-line-strong bg-surface/70 py-6 text-sm font-medium text-accent transition-colors hover:border-line-strong hover:bg-surface"
              >
                {t(
                  "dashboard.loadDetailedAnalytics",
                  "Load detailed analytics",
                )}
              </button>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
