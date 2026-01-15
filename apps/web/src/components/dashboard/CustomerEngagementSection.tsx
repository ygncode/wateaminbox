import { Activity, ArrowRightLeft, Image, Reply, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { useAsyncData } from "@/hooks";
import {
  formatNumber,
  useEngagementMetrics,
  useEngagementTrend,
} from "@/hooks/analytics";
import { StatCard } from "./StatCard";
import { EngagementTrendChart } from "./charts";

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
  const engagementQuery = useEngagementMetrics(companyId, startDate, endDate);
  const trendQuery = useEngagementTrend(companyId, startDate, endDate);

  const engagementState = useAsyncData(engagementQuery);
  const trendState = useAsyncData(trendQuery);

  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
        <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
          Customer Engagement
        </h3>
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
            Failed to load engagement data
          </p>
        ),
        empty: () => (
          <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
            No engagement data available
          </p>
        ),
        success: (response) => {
          const data = response.data;
          const trendData = trendState.data?.data;

          return (
            <div className="space-y-6">
              {/* Engagement Score Highlight */}
              <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-dark-tertiary rounded-lg">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-white dark:bg-dark-secondary flex items-center justify-center shadow-sm">
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                      {data.engagementScore}
                    </span>
                  </div>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-dark-text-tertiary">
                    /100
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                    Engagement Score
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                    Based on activity, response rate, and interaction patterns
                  </p>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  variant="compact"
                  icon={<Activity className="h-5 w-5" />}
                  label="Active Contacts"
                  value={data.activeContactsRate}
                  suffix="%"
                  detail={`${data.activeContacts} of ${data.totalContacts}`}
                  color="blue"
                />
                <StatCard
                  variant="compact"
                  icon={<ArrowRightLeft className="h-5 w-5" />}
                  label="Two-Way Chats"
                  value={data.twoWayConversationRate}
                  suffix="%"
                  detail={`${data.twoWayConversations} conversations`}
                  color="green"
                />
                <StatCard
                  variant="compact"
                  icon={<Reply className="h-5 w-5" />}
                  label="Response Rate"
                  value={data.responseRate}
                  suffix="%"
                  detail={`${formatNumber(data.messagesReceived)} inbound`}
                  color="purple"
                />
                <StatCard
                  variant="compact"
                  icon={<Image className="h-5 w-5" />}
                  label="Media Engagement"
                  value={data.mediaEngagementRate}
                  suffix="%"
                  detail={`${data.conversationsWithMedia} with media`}
                  color="orange"
                />
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-3 gap-4 pt-2 border-t border-gray-100 dark:border-dark-border">
                <div className="text-center">
                  <p className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
                    {data.averageMessagesPerContact}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Avg. messages per contact
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-green-600 dark:text-green-400">
                    {formatNumber(data.messagesSent)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Messages sent
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-blue-600 dark:text-blue-400">
                    {formatNumber(data.messagesReceived)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Messages received
                  </p>
                </div>
              </div>

              {/* Engagement Trend Chart */}
              {!trendState.isLoading && trendData && trendData.length > 0 && (
                <div className="pt-4 border-t border-gray-100 dark:border-dark-border">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-dark-text-primary mb-3">
                    Engagement Trend (Last 14 Days)
                  </h4>
                  <EngagementTrendChart data={trendData} />
                </div>
              )}
            </div>
          );
        },
      })}
    </div>
  );
}
