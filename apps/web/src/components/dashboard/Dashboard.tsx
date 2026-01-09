import { useState } from "react";
import { getDateRange, toISOString } from "@whatsapp-web/shared";
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
} from "@/hooks/useAnalytics";
import { CustomerEngagementSection } from "./CustomerEngagementSection";
import { DashboardHeader, type DateRange, type ExportType } from "./DashboardHeader";
import { DashboardStats } from "./DashboardStats";
import { TrendChartsRow, StatsCardsRow } from "./DashboardCharts";
import { ResolutionRateSection } from "./ResolutionRateSection";
import { ResponseTimeAnalytics } from "./ResponseTimeAnalytics";

export interface DashboardProps {
  companyId: string;
  isAdmin?: boolean;
}

/**
 * Analytics Dashboard component
 */
export function Dashboard({ companyId, isAdmin = false }: DashboardProps) {
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [exportType, setExportType] = useState<ExportType | null>(null);

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
  } = useContactStats(companyId);
  const {
    data: messageTypes,
    isLoading: isLoadingTypes,
    isError: isTypesError,
  } = useMessageTypeStats(companyId);
  const {
    data: hourlyStats,
    isLoading: isLoadingHourly,
    isError: isHourlyError,
  } = useHourlyStats(companyId);
  const {
    data: teamStats,
    isLoading: isLoadingTeam,
    isError: isTeamError,
  } = useTeamActivityStats(isAdmin ? companyId : null);
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
          dateRange={dateRange}
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

        {/* Overview Cards */}
        <DashboardStats data={dashboardStats} isLoading={isLoadingDashboard} />

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

        {/* Bottom Row: Contact Stats, Message Types, Team Activity */}
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

        {/* Resolution Rate Analytics */}
        <ResolutionRateSection
          companyId={companyId}
          startDate={startDate}
          endDate={endDate}
        />

        {/* Customer Engagement Analytics */}
        <CustomerEngagementSection
          companyId={companyId}
          startDate={startDate}
          endDate={endDate}
        />

        {/* Response Time Analytics */}
        <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
          <ResponseTimeAnalytics
            companyId={companyId}
            isAdmin={isAdmin}
            slaThreshold={60}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

export default Dashboard;
