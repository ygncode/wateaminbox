import { useQuery } from "@tanstack/react-query";
import { dayjs, getDateRange } from "@wateaminbox/shared";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import {
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
  getTeamResponseTimeStats,
} from "../../lib/api";
import { ResponseTimeTrendChart } from "./charts";

type TimeRange = "7d" | "30d" | "90d";

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getSlaColor(rate: number): string {
  if (rate >= 90) return "text-green-600";
  if (rate >= 70) return "text-yellow-600";
  return "text-red-600";
}

interface ResponseTimeAnalyticsProps {
  companyId: string;
  dateRange: TimeRange;
  isAdmin?: boolean;
  slaThreshold?: number;
}

export function ResponseTimeAnalytics({
  companyId,
  dateRange,
  isAdmin = false,
  slaThreshold = 60,
}: ResponseTimeAnalyticsProps) {
  const dates = useMemo(() => {
    const { start, end } = getDateRange(dateRange);
    return { start: start.toDate(), end: end.toDate() };
  }, [dateRange]);

  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery({
    queryKey: [
      "responseTimeStats",
      companyId,
      dates.start,
      dates.end,
      slaThreshold,
    ],
    queryFn: () => getResponseTimeStats(dates.start, dates.end, slaThreshold),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: trendData,
    isLoading: trendLoading,
    isError: trendError,
  } = useQuery({
    queryKey: [
      "responseTimeTrend",
      companyId,
      dates.start,
      dates.end,
      slaThreshold,
    ],
    queryFn: () => getResponseTimeTrend(dates.start, dates.end, slaThreshold),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: teamData } = useQuery({
    queryKey: [
      "teamResponseTime",
      companyId,
      dates.start,
      dates.end,
      slaThreshold,
    ],
    queryFn: () =>
      getTeamResponseTimeStats(dates.start, dates.end, slaThreshold),
    enabled: !!companyId && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const { data: breachData } = useQuery({
    queryKey: ["slaBreaches", companyId, dates.start, dates.end, slaThreshold],
    queryFn: () => getSlaBreaches(dates.start, dates.end, slaThreshold, 10),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const stats = statsData;
  const trend = trendData?.trend || [];
  const team = teamData?.stats || [];
  const breaches = breachData?.breaches || [];

  const isLoading = statsLoading || trendLoading;
  const hasPrimaryError = statsError || trendError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf1f7] text-[#4185c5] dark:bg-blue-950/40 dark:text-blue-300">
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
              Response performance
            </h2>
            <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
              First-response speed and SLA reliability
            </p>
          </div>
        </div>
        <span className="rounded-full border border-[#dce3de] bg-[#fafcfb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#718078] dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text-secondary">
          Last {dateRange === "7d" ? "7" : dateRange === "30d" ? "30" : "90"}{" "}
          days
        </span>
      </div>

      {hasPrimaryError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        >
          Response-time analytics could not be loaded. Please try again shortly.
        </div>
      )}

      {/* Stats Cards */}
      {!hasPrimaryError && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
            <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
              <Clock className="h-3.5 w-3.5" />
              Avg Response
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
              {isLoading
                ? "-"
                : formatMinutes(stats?.averageResponseTimeMinutes || 0)}
            </div>
            <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
              Median:{" "}
              {isLoading
                ? "-"
                : formatMinutes(stats?.medianResponseTimeMinutes || 0)}
            </div>
          </div>

          <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
            <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
              <CheckCircle className="h-3.5 w-3.5" />
              SLA Compliance
            </div>
            <div
              className={`mt-2 text-2xl font-semibold tracking-[-0.02em] ${
                isLoading
                  ? "text-[#203b32] dark:text-dark-text-primary"
                  : getSlaColor(stats?.slaComplianceRate || 0)
              }`}
            >
              {isLoading
                ? "-"
                : `${Math.round(stats?.slaComplianceRate || 0)}%`}
            </div>
            <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
              Target: {slaThreshold} min
            </div>
          </div>

          <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
            <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
              <TrendingUp className="h-3.5 w-3.5" />
              Responses
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
              {isLoading ? "-" : stats?.totalConversations || 0}
            </div>
            <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
              {isLoading ? "-" : stats?.withinSlaCount || 0} within SLA
            </div>
          </div>

          <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
            <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
              <AlertTriangle className="h-3.5 w-3.5" />
              Max Response
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
              {isLoading
                ? "-"
                : formatMinutes(stats?.maxResponseTimeMinutes || 0)}
            </div>
            <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
              Min:{" "}
              {isLoading
                ? "-"
                : formatMinutes(stats?.minResponseTimeMinutes || 0)}
            </div>
          </div>
        </div>
      )}

      {/* Trend Chart */}
      {!hasPrimaryError && trend.length > 0 && (
        <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/30 sm:p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
              Response-time trend
            </h3>
            <p className="mt-0.5 text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
              Daily average compared with the {slaThreshold}-minute target
            </p>
          </div>
          <ResponseTimeTrendChart data={trend} slaThreshold={slaThreshold} />
        </div>
      )}

      {/* Team Performance (Admin only) */}
      {isAdmin && team.length > 0 && (
        <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/30">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#65736d] dark:text-dark-text-secondary" />
            <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
              Team response times
            </h3>
          </div>
          <div className="space-y-1">
            {team.slice(0, 5).map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white dark:hover:bg-dark-tertiary"
              >
                <div>
                  <div className="text-xs font-medium text-[#40544c] dark:text-dark-text-primary">
                    {member.email}
                  </div>
                  <div className="text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                    {member.totalResponses} responses
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-[#203b32] dark:text-dark-text-primary">
                    {formatMinutes(member.averageResponseTimeMinutes)}
                  </div>
                  <div
                    className={`text-xs ${getSlaColor(member.slaComplianceRate)}`}
                  >
                    {Math.round(member.slaComplianceRate)}% SLA
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLA Breaches */}
      {breaches.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/70 dark:bg-red-950/20">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <h3 className="text-sm font-semibold text-red-900 dark:text-red-300">
              SLA Breaches
            </h3>
            <span className="rounded bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
              {breaches.length}
            </span>
          </div>
          <div className="space-y-2">
            {breaches.slice(0, 5).map((breach) => (
              <div
                key={`${breach.contactId}-${breach.inboundMessageTime}`}
                className="flex items-center justify-between rounded-lg border border-red-100 bg-white px-3 py-2 text-xs dark:border-red-900/50 dark:bg-dark-elevated"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-dark-text-primary">
                    {breach.contactName || breach.contactId}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-dark-text-secondary">
                    {dayjs(breach.inboundMessageTime).format("MMM D, YYYY")}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {formatMinutes(breach.responseMinutes)}
                  </span>
                  {breach.responseTime ? (
                    <span className="ml-2 text-xs text-gray-500 dark:text-dark-text-secondary">
                      responded
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-red-500 dark:text-red-400">
                      no response
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
