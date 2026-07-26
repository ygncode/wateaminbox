import { getDateRange, toISOString } from "@wateaminbox/shared";
import { useEffect, useRef, useState } from "react";
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
      { rootMargin: "500px 0px" },
    );
    observer.observe(secondarySentinelRef.current);
    return () => observer.disconnect();
  }, [showSecondary]);

  const getDates = () => {
    const { start, end } = getDateRange(dateRange);
    return { startDate: toISOString(start), endDate: toISOString(end) };
  };

  const { startDate, endDate } = getDates();

  // Data fetching hooks
  const { data: dashboardStats, isLoading: isLoadingDashboard } =
    useDashboardStats(companyId);
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
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <DashboardHeader
          workspaceName={workspaceName}
          dateRange={dateRange}
          canExport={canExport}
          onDateRangeChange={setDateRange}
          onExport={setExportType}
        />

        {/* Export Dialog */}
        {exportType && (
          <ExportDialog
            open={!!exportType}
            onOpenChange={(open) => !open && setExportType(null)}
            type={exportType}
          />
        )}

        <section aria-labelledby="operational-overview-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="operational-overview-title"
              className="text-sm font-semibold"
            >
              Operational overview
            </h2>
            <span className="rounded-full bg-[#edf1ed] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#65736d] dark:bg-dark-tertiary dark:text-dark-text-secondary">
              All time
            </span>
          </div>
          <DashboardStats
            data={dashboardStats}
            isLoading={isLoadingDashboard}
          />
        </section>

        {/* Charts Row */}
        <TrendChartsRow
          messageData={messageData?.data}
          isLoadingMessages={isLoadingMessages}
          isMessagesError={isMessagesError}
          contactsTrendData={contactsTrendData?.data}
          isLoadingContactsTrend={isLoadingContactsTrend}
          isContactsTrendError={isContactsTrendError}
          hourlyStats={hourlyStats}
          isLoadingHourly={isLoadingHourly}
          isHourlyError={isHourlyError}
        />

        <div ref={secondarySentinelRef} className="h-px" aria-hidden="true" />
        {showSecondary ? (
          <>
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
              startDate={startDate}
              endDate={endDate}
            />
            <CustomerEngagementSection
              companyId={companyId}
              startDate={startDate}
              endDate={endDate}
            />
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-dark-border dark:bg-dark-elevated sm:p-6">
              <ResponseTimeAnalytics
                companyId={companyId}
                isAdmin={isAdmin}
                slaThreshold={60}
              />
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowSecondary(true)}
            className="w-full rounded-xl border border-dashed border-[#cbd6cf] bg-white/60 py-6 text-sm font-medium text-[#0b7a55] hover:bg-white dark:border-dark-border dark:bg-dark-elevated/50 dark:hover:bg-dark-elevated"
          >
            Load detailed analytics
          </button>
        )}
      </div>
    </ScrollArea>
  );
}

export default Dashboard;
