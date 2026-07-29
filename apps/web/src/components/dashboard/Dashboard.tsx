import { getDateRange, toISOString } from "@wateaminbox/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary">
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
        <ScrollArea className="h-full rounded-xl border border-[#dce3de] bg-[#f9fbf9] shadow-sm dark:border-dark-border dark:bg-dark-secondary">
          <div className="space-y-6 p-4 sm:p-5 lg:p-6">
            <section aria-labelledby="operational-overview-title">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2
                    id="operational-overview-title"
                    className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary"
                  >
                    Operational overview
                  </h2>
                  <p className="mt-0.5 text-xs text-[#718078] dark:text-dark-text-secondary">
                    A live pulse of messaging and workspace activity.
                  </p>
                </div>
                <span className="rounded-full border border-[#dce3de] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#65736d] dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-secondary">
                  All time
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
                <h2 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
                  Activity trends
                </h2>
                <p className="mt-0.5 text-xs text-[#718078] dark:text-dark-text-secondary">
                  Volume, acquisition, and traffic patterns.
                </p>
              </div>
              <span className="rounded-full bg-[#edf2ef] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#65736d] dark:bg-dark-tertiary dark:text-dark-text-secondary">
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
                <div className="border-t border-[#dce3de] pt-6 dark:border-dark-border">
                  <h2 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
                    Workspace insights
                  </h2>
                  <p className="mt-0.5 text-xs text-[#718078] dark:text-dark-text-secondary">
                    Deeper signals for contact quality, outcomes, and service
                    performance.
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
                <ResolutionRateSection companyId={companyId} />
                <CustomerEngagementSection
                  companyId={companyId}
                  startDate={startDate}
                  endDate={endDate}
                />
                <div className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
                  <ResponseTimeAnalytics
                    companyId={companyId}
                    dateRange={dateRange}
                    isAdmin={isAdmin}
                    slaThreshold={60}
                  />
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowSecondary(true)}
                className="w-full rounded-xl border border-dashed border-[#cbd6cf] bg-white/70 py-6 text-sm font-medium text-[#0b7a55] transition-colors hover:border-[#8cb7a4] hover:bg-white dark:border-dark-border dark:bg-dark-elevated/50 dark:hover:bg-dark-elevated"
              >
                Load detailed analytics
              </button>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default Dashboard;
