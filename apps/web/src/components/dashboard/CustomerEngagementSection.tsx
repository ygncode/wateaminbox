import { Activity, ArrowRightLeft, Image, Reply, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatNumber,
  useEngagementMetrics,
  useEngagementTrend,
} from "@/hooks/analytics";
import { useAsyncData } from "@/hooks/useAsyncData";
import { EngagementTrendChart } from "./charts";
import { StatCard } from "./StatCard";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

interface CustomerEngagementSectionProps {
  companyId: string;
  startDate: string;
  endDate: string;
}

/**
 * Self-contained Customer Engagement analytics section.
 * Fetches its own data (metrics + trend) and handles loading/error/empty states internally.
 */
export function CustomerEngagementSection({
  companyId,
  startDate,
  endDate,
}: CustomerEngagementSectionProps) {
  const { t } = useTranslation();

  const engagementQuery = useEngagementMetrics(companyId, startDate, endDate);
  const trendQuery = useEngagementTrend(companyId, startDate, endDate);

  const engagementState = useAsyncData(engagementQuery);
  const trendState = useAsyncData(trendQuery);

  return (
    <section className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff3e2] text-[#b36c24] dark:bg-amber-950/40 dark:text-amber-300">
          <Zap className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
            {t("dashboard.engagementPanel.title", "Customer engagement")}
          </h3>
          <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
            {t(
              "dashboard.engagementPanel.subtitle",
              "Interaction quality across the selected period",
            )}
          </p>
        </div>
      </div>

      {engagementState.renderState({
        loading: () => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="h-48 w-full" />
          </div>
        ),
        error: () => (
          <p className="text-red-500 dark:text-red-400 text-center py-4">
            {t(
              "dashboard.engagementPanel.loadFailed",
              "Failed to load engagement data",
            )}
          </p>
        ),
        empty: () => (
          <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
            {t(
              "dashboard.engagementPanel.empty",
              "No engagement data available",
            )}
          </p>
        ),
        success: (data) => {
          const trendData = trendState.data;

          return (
            <div className="space-y-6">
              <div className="grid gap-4 xl:grid-cols-[17rem_1fr]">
                <div className="relative overflow-hidden rounded-xl bg-[#173c31] p-5 text-white shadow-[inset_0_1px_rgba(255,255,255,0.08)]">
                  <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full border border-white/10" />
                  <div className="absolute -bottom-16 right-8 h-32 w-32 rounded-full bg-emerald-300/5" />
                  <p className="relative text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100/70">
                    {t("dashboard.engagementPanel.score", "Engagement score")}
                  </p>
                  <div className="relative mt-5 flex items-center gap-4">
                    <div
                      className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-[7px]"
                      style={{
                        background: `conic-gradient(#59d7a5 ${data.engagementScore * 3.6}deg, rgba(255,255,255,0.13) 0deg)`,
                      }}
                    >
                      <div className="grid h-full w-full place-items-center rounded-full bg-[#173c31]">
                        <span className="text-2xl font-semibold tabular-nums">
                          {data.engagementScore}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {getEngagementLabel(t, data.engagementScore)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-emerald-100/70">
                        {t(
                          "dashboard.engagementPanel.scoreHint",
                          "Activity, replies, and two-way interactions.",
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-2">
                  <StatCard
                    variant="compact"
                    icon={<Activity className="h-4 w-4" />}
                    label={t(
                      "dashboard.engagementPanel.activeContacts",
                      "Active Contacts",
                    )}
                    value={data.activeContactsRate}
                    suffix="%"
                    detail={`${data.activeContacts} of ${data.totalContacts}`}
                    color="blue"
                  />
                  <StatCard
                    variant="compact"
                    icon={<ArrowRightLeft className="h-4 w-4" />}
                    label={t(
                      "dashboard.engagementPanel.twoWayChats",
                      "Two-Way Chats",
                    )}
                    value={data.twoWayConversationRate}
                    suffix="%"
                    detail={`${data.twoWayConversations} conversations`}
                    color="green"
                  />
                  <StatCard
                    variant="compact"
                    icon={<Reply className="h-4 w-4" />}
                    label={t(
                      "dashboard.engagementPanel.responseRate",
                      "Response Rate",
                    )}
                    value={data.responseRate}
                    suffix="%"
                    detail={`${formatNumber(data.messagesReceived)} inbound`}
                    color="purple"
                  />
                  <StatCard
                    variant="compact"
                    icon={<Image className="h-4 w-4" />}
                    label={t(
                      "dashboard.engagementPanel.mediaEngagement",
                      "Media Engagement",
                    )}
                    value={data.mediaEngagementRate}
                    suffix="%"
                    detail={`${data.conversationsWithMedia} with media`}
                    color="orange"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 divide-x divide-[#e3e9e5] rounded-xl border border-[#e3e9e5] bg-[#fafcfb] py-4 dark:divide-dark-border dark:border-dark-border dark:bg-dark-tertiary/40">
                <div className="px-3 text-center">
                  <p className="text-xl font-semibold tracking-[-0.02em] text-[#203b32] dark:text-dark-text-primary">
                    {data.averageMessagesPerContact}
                  </p>
                  <p className="mt-1 text-[10px] text-[#7a8881] dark:text-dark-text-secondary">
                    {t(
                      "dashboard.engagementPanel.avgPerContact",
                      "Avg. per contact",
                    )}
                  </p>
                </div>
                <div className="px-3 text-center">
                  <p className="text-xl font-semibold tracking-[-0.02em] text-[#0b7a55] dark:text-emerald-300">
                    {formatNumber(data.messagesSent)}
                  </p>
                  <p className="mt-1 text-[10px] text-[#7a8881] dark:text-dark-text-secondary">
                    {t(
                      "dashboard.engagementPanel.messagesSent",
                      "Messages sent",
                    )}
                  </p>
                </div>
                <div className="px-3 text-center">
                  <p className="text-xl font-semibold tracking-[-0.02em] text-[#4185c5] dark:text-blue-300">
                    {formatNumber(data.messagesReceived)}
                  </p>
                  <p className="mt-1 text-[10px] text-[#7a8881] dark:text-dark-text-secondary">
                    {t(
                      "dashboard.engagementPanel.messagesReceived",
                      "Messages received",
                    )}
                  </p>
                </div>
              </div>

              {trendState.isError ? (
                <p
                  role="status"
                  className="border-t border-[#e3e9e5] pt-4 text-center text-sm text-red-600 dark:border-dark-border dark:text-red-400"
                >
                  {t(
                    "dashboard.engagementPanel.trendLoadFailed",
                    "The engagement trend could not be loaded.",
                  )}
                </p>
              ) : (
                !trendState.isLoading &&
                trendData &&
                trendData.length > 0 && (
                  <div className="border-t border-[#e3e9e5] pt-5 dark:border-dark-border">
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
                        {t(
                          "dashboard.engagementPanel.trendTitle",
                          "Engagement trend",
                        )}
                      </h4>
                      <p className="mt-0.5 text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
                        {t(
                          "dashboard.engagementPanel.trendSubtitle",
                          "Engagement score compared with response rate",
                        )}
                      </p>
                    </div>
                    <EngagementTrendChart data={trendData} />
                  </div>
                )
              )}
            </div>
          );
        },
      })}
    </section>
  );
}

function getEngagementLabel(t: TFunction, score: number): string {
  if (score >= 75)
    return t("dashboard.engagementPanel.levels.strong", "Strong");
  if (score >= 50)
    return t("dashboard.engagementPanel.levels.healthy", "Healthy");
  if (score >= 25)
    return t("dashboard.engagementPanel.levels.developing", "Developing");
  return t(
    "dashboard.engagementPanel.levels.needsAttention",
    "Needs attention",
  );
}
