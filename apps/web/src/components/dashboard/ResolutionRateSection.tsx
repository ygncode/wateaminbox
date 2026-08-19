import { dayjs, getDateRange } from "@wateaminbox/shared";
import { AlertTriangle, CheckCircle, Clock, Target, Users } from "lucide-react";
import { useMemo } from "react";
import {
  useOverdueActiveCases,
  useResolutionStats,
  useResolutionTeamStats,
  useResolutionTrend,
} from "@/hooks/analytics";
import { ResolutionTrendChart } from "./charts";
import type { DateRange } from "./DashboardHeader";
import { useTranslation } from "react-i18next";

interface ResolutionRateSectionProps {
  companyId: string;
  dateRange: DateRange;
  isAdmin?: boolean;
}

/** Optional translator keeps this usable outside a React render. */
type MinutesTranslate = (
  key: string,
  options: { defaultValue: string } & Record<string, unknown>,
) => string;

const englishMinutes: MinutesTranslate = (_key, options) =>
  options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    String(options[name] ?? ""),
  );

function formatMinutes(
  minutes: number,
  t: MinutesTranslate = englishMinutes,
): string {
  if (minutes < 1)
    return t("duration.lessThanAMinute", { defaultValue: "< 1 min" });
  if (minutes < 60)
    return t("duration.minutes", {
      defaultValue: "{{count}} min",
      count: Math.round(minutes),
    });
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0
    ? t("duration.hoursMinutes", {
        defaultValue: "{{hours}}h {{minutes}}m",
        hours,
        minutes: mins,
      })
    : t("duration.hours", { defaultValue: "{{hours}}h", hours });
}

function getSlaColor(rate: number): string {
  if (rate >= 90) return "text-green-600";
  if (rate >= 70) return "text-yellow-600";
  return "text-red-600";
}

/**
 * Resolution-SLA analytics: case-cycle compliance/duration, currently
 * overdue active work (never scoped to the selected date range - see the
 * API), direct/group breakdown, and team attribution.
 */
export function ResolutionRateSection({
  companyId,
  dateRange,
  isAdmin = false,
}: ResolutionRateSectionProps) {
  const { t } = useTranslation();

  const { startDate, endDate } = useMemo(() => {
    const { start, end } = getDateRange(dateRange);
    return { startDate: start.toDate(), endDate: end.toDate() };
  }, [dateRange]);

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useResolutionStats(companyId, startDate, endDate);
  const { data: team, isError: teamError } = useResolutionTeamStats(
    isAdmin ? companyId : null,
    startDate,
    endDate,
  );
  const { data: overdueCases, isError: overdueError } =
    useOverdueActiveCases(companyId);
  const {
    data: trend,
    isLoading: trendLoading,
    isError: trendError,
  } = useResolutionTrend(companyId, startDate, endDate);

  return (
    <section className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5f2ec] text-[#0b7a55] dark:bg-emerald-950/50 dark:text-emerald-300">
          <Target className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
            {t("dashboard.resolution.title", "Resolution SLA")}
          </h3>
          <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
            {t(
              "dashboard.resolution.subtitle",
              "How fast conversations get closed out",
            )}
          </p>
        </div>
        <span className="ml-auto rounded-full border border-[#dce3de] bg-[#fafcfb] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#718078] dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text-secondary">
          {dayjs(startDate).format("MMM D")} – {dayjs(endDate).format("MMM D")}
        </span>
      </div>

      {statsError && (
        <p className="text-red-500 dark:text-red-400 text-center py-4">
          {t(
            "dashboard.resolution.loadFailed",
            "Failed to load resolution data",
          )}
        </p>
      )}

      {!statsError && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
              <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                <Clock className="h-3.5 w-3.5" />
                {t("dashboard.resolution.avgResolution", "Avg Resolution")}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
                {statsLoading
                  ? "-"
                  : formatMinutes(stats?.averageResolutionMinutes || 0, t)}
              </div>
              <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                Median:{" "}
                {statsLoading
                  ? "-"
                  : formatMinutes(stats?.medianResolutionMinutes || 0, t)}
              </div>
            </div>

            <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
              <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                <CheckCircle className="h-3.5 w-3.5" />
                {t("dashboard.resolution.slaCompliance", "SLA Compliance")}
              </div>
              <div
                className={`mt-2 text-2xl font-semibold tracking-[-0.02em] ${
                  statsLoading
                    ? "text-[#203b32] dark:text-dark-text-primary"
                    : getSlaColor(stats?.slaComplianceRate || 0)
                }`}
              >
                {statsLoading
                  ? "-"
                  : `${Math.round(stats?.slaComplianceRate || 0)}%`}
              </div>
              <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                {statsLoading ? "-" : stats?.totalEvaluated || 0} evaluated
              </div>
            </div>

            <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
              <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                <CheckCircle className="h-3.5 w-3.5" />
                Resolved
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
                {statsLoading ? "-" : stats?.totalResolvedCases || 0}
              </div>
              <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                {statsLoading ? "-" : stats?.withinSlaCount || 0} within SLA
              </div>
            </div>

            <div className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
              <div className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("dashboard.resolution.overdueActive", "Overdue Active")}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-red-600 dark:text-red-400">
                {statsLoading ? "-" : stats?.overdueActiveCases || 0}
              </div>
              <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                {t("dashboard.resolution.rightNowAnyAge", "Right now, any age")}
              </div>
            </div>
          </div>

          {/* Direct vs. group breakdown */}
          {!statsLoading && stats && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["direct", "group"] as const).map((kind) => {
                const k = stats.byKind[kind];
                return (
                  <div
                    key={kind}
                    className="rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-3 dark:border-dark-border dark:bg-dark-tertiary/30"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold capitalize text-[#40544c] dark:text-dark-text-primary">
                        {kind} chats
                      </span>
                      <span
                        className={`text-xs font-semibold ${getSlaColor(k.slaComplianceRate)}`}
                      >
                        {Math.round(k.slaComplianceRate)}%
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-[#87928c] dark:text-dark-text-secondary">
                      {k.totalResolvedCases} resolved · avg{" "}
                      {formatMinutes(k.averageResolutionMinutes, t)} ·{" "}
                      {k.overdueActiveCases} overdue
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resolution trend */}
          <div className="mt-4">
            {trendError ? (
              <p className="rounded-xl border border-dashed border-red-200 bg-red-50/50 py-4 text-center text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/10 dark:text-red-400">
                {t(
                  "dashboard.resolution.trendLoadFailed",
                  "Failed to load resolution trend",
                )}
              </p>
            ) : trendLoading ? (
              <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-[#dce3de] bg-[#fafcfb] text-sm text-[#718078] dark:border-dark-border dark:bg-dark-secondary/40 dark:text-dark-text-secondary">
                {t("dashboard.resolution.loadingTrend", "Loading trend…")}
              </div>
            ) : (
              <ResolutionTrendChart data={trend ?? []} />
            )}
          </div>

          {/* Overdue work queue */}
          {overdueError && (
            <p className="mt-4 rounded-xl border border-dashed border-red-200 bg-red-50/50 py-4 text-center text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/10 dark:text-red-400">
              {t(
                "dashboard.resolution.queueLoadFailed",
                "Failed to load overdue work queue",
              )}
            </p>
          )}
          {!overdueError && overdueCases && overdueCases.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/70 dark:bg-red-950/20">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-300">
                  {t("dashboard.resolution.overdueQueue", "Overdue work queue")}
                </h3>
                <span className="rounded bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                  {overdueCases.length}
                </span>
              </div>
              <div className="space-y-2">
                {overdueCases.slice(0, 5).map((item) => (
                  <div
                    key={item.caseId}
                    className="flex items-center justify-between rounded-lg border border-red-100 bg-white px-3 py-2 text-xs dark:border-red-900/50 dark:bg-dark-elevated"
                  >
                    <div>
                      <span className="font-medium text-gray-900 dark:text-dark-text-primary">
                        {item.contactName || item.contactId}
                      </span>
                      <span className="ml-2 capitalize text-gray-500 dark:text-dark-text-secondary">
                        {item.kind}
                      </span>
                    </div>
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {formatMinutes(item.elapsedMinutes, t)} elapsed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team attribution (admin only) */}
          {isAdmin && teamError && (
            <p className="mt-4 rounded-xl border border-dashed border-red-200 bg-red-50/50 py-4 text-center text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/10 dark:text-red-400">
              {t(
                "dashboard.resolution.teamLoadFailed",
                "Failed to load team resolution times",
              )}
            </p>
          )}
          {isAdmin && !teamError && team && team.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#e3e9e5] bg-[#fafcfb] p-4 dark:border-dark-border dark:bg-dark-tertiary/30">
              <div className="mb-4 flex items-center gap-2">
                <Users className="h-4 w-4 text-[#65736d] dark:text-dark-text-secondary" />
                <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
                  {t("dashboard.resolution.teamTimes", "Team resolution times")}
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
                        {member.totalResolvedCases} resolved
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-[#203b32] dark:text-dark-text-primary">
                        {formatMinutes(member.averageResolutionMinutes, t)}
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
        </>
      )}
    </section>
  );
}
