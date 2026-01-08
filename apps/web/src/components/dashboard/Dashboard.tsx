import {
  Activity,
  Archive,
  ArrowRightLeft,
  BarChart3,
  CheckCircle,
  CircleDot,
  Clock,
  Download,
  Image,
  Inbox,
  MessageSquare,
  Reply,
  Send,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { getDateRange, toISOString } from "@whatsapp-web/shared";
import { ExportDialog } from "@/components/export";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Skeleton,
} from "@/components/ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatNumber,
  useContactStats,
  useDashboardStats,
  useEngagementMetrics,
  useEngagementTrend,
  useHourlyStats,
  useMessageStats,
  useMessageTypeStats,
  useNewContactsTrend,
  useResolutionStats,
  useTeamActivityStats,
} from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import { ResponseTimeAnalytics } from "./ResponseTimeAnalytics";
import { StatCard } from "./StatCard";
import { StatRow } from "./StatRow";
import { ResolutionStatCard } from "./ResolutionStatCard";
import { EngagementStatCard } from "./EngagementStatCard";
import {
  MessageChart,
  HourlyChart,
  NewContactsChart,
  EngagementTrendChart,
} from "./charts";

export interface DashboardProps {
  companyId: string;
  isAdmin?: boolean;
}

/**
 * Analytics Dashboard component
 */
export function Dashboard({ companyId, isAdmin = false }: DashboardProps) {
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d");
  const [exportType, setExportType] = useState<
    "contacts" | "messages" | "full-backup" | null
  >(null);

  const getDates = () => {
    const { start, end } = getDateRange(dateRange);
    return { startDate: toISOString(start), endDate: toISOString(end) };
  };

  const { startDate, endDate } = getDates();

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
  const {
    data: resolutionData,
    isLoading: isLoadingResolution,
    isError: isResolutionError,
  } = useResolutionStats(companyId, startDate, endDate);
  const {
    data: engagementData,
    isLoading: isLoadingEngagement,
    isError: isEngagementError,
  } = useEngagementMetrics(companyId, startDate, endDate);
  const { data: engagementTrendData, isLoading: isLoadingEngagementTrend } =
    useEngagementTrend(companyId, startDate, endDate);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
            Dashboard
          </h1>
          <div className="flex gap-2">
            {/* Export Buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportType("full-backup")}
              className="gap-1"
            >
              <Archive className="h-4 w-4" />
              Full Backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportType("contacts")}
              className="gap-1"
            >
              <Download className="h-4 w-4" />
              Export Contacts
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportType("messages")}
              className="gap-1"
            >
              <Download className="h-4 w-4" />
              Export Messages
            </Button>
            <div className="w-px bg-gray-200 dark:bg-dark-border mx-1" />
            {(["7d", "30d", "90d"] as const).map((range) => (
              <Button
                key={range}
                variant={dateRange === range ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange(range)}
                className={cn(
                  dateRange === range &&
                    "bg-whatsapp-teal-green hover:bg-whatsapp-dark-green",
                )}
              >
                {range === "7d"
                  ? "7 Days"
                  : range === "30d"
                    ? "30 Days"
                    : "90 Days"}
              </Button>
            ))}
          </div>
        </div>

        {/* Export Dialog */}
        {exportType && (
          <ExportDialog
            open={!!exportType}
            onOpenChange={(open) => !open && setExportType(null)}
            type={exportType}
          />
        )}

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            icon={<MessageSquare className="h-5 w-5" />}
            label="Total Messages"
            value={dashboardStats?.totalMessages}
            isLoading={isLoadingDashboard}
          />
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Total Contacts"
            value={dashboardStats?.totalContacts}
            isLoading={isLoadingDashboard}
          />
          <StatCard
            icon={<UserCheck className="h-5 w-5" />}
            label="Active Team"
            value={dashboardStats?.activeUsers}
            isLoading={isLoadingDashboard}
          />
          <StatCard
            icon={<Send className="h-5 w-5" />}
            label="Sent Today"
            value={dashboardStats?.messagesSentToday}
            isLoading={isLoadingDashboard}
            accent="green"
          />
          <StatCard
            icon={<Inbox className="h-5 w-5" />}
            label="Received Today"
            value={dashboardStats?.messagesReceivedToday}
            isLoading={isLoadingDashboard}
            accent="blue"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label="Unread"
            value={dashboardStats?.unreadConversations}
            isLoading={isLoadingDashboard}
            accent="orange"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Message Trend */}
          <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
              <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                Message Trend
              </h3>
            </div>
            {isLoadingMessages ? (
              <Skeleton className="h-48 w-full" />
            ) : isMessagesError ? (
              <p className="text-red-500 dark:text-red-400 text-center py-8">
                Failed to load data
              </p>
            ) : (
              <MessageChart data={messageData?.data || []} />
            )}
          </div>

          {/* New Contacts Trend */}
          <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
              <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                New Contacts
              </h3>
            </div>
            {isLoadingContactsTrend ? (
              <Skeleton className="h-48 w-full" />
            ) : isContactsTrendError ? (
              <p className="text-red-500 dark:text-red-400 text-center py-8">
                Failed to load data
              </p>
            ) : (
              <NewContactsChart data={contactsTrendData?.data || []} />
            )}
          </div>

          {/* Hourly Distribution */}
          <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
              <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                Hourly Activity
              </h3>
            </div>
            {isLoadingHourly ? (
              <Skeleton className="h-48 w-full" />
            ) : isHourlyError ? (
              <p className="text-red-500 dark:text-red-400 text-center py-8">
                Failed to load data
              </p>
            ) : (
              <HourlyChart data={hourlyStats || []} />
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact Stats */}
          <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
              <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                Contact Stats
              </h3>
            </div>
            {isLoadingContacts ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : isContactsError ? (
              <p className="text-red-500 dark:text-red-400 text-center py-4">
                Failed to load data
              </p>
            ) : contactStats ? (
              <div className="space-y-3">
                <StatRow
                  label="With Custom Names"
                  value={contactStats.withCustomName}
                  total={contactStats.total}
                />
                <StatRow
                  label="With Tags"
                  value={contactStats.withTags}
                  total={contactStats.total}
                />
                <StatRow
                  label="Assigned"
                  value={contactStats.assigned}
                  total={contactStats.total}
                />
                <StatRow
                  label="Unassigned"
                  value={contactStats.unassigned}
                  total={contactStats.total}
                />
              </div>
            ) : (
              <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
                No data available
              </p>
            )}
          </div>

          {/* Message Types */}
          <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
              <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                Message Types
              </h3>
            </div>
            {isLoadingTypes ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : isTypesError ? (
              <p className="text-red-500 dark:text-red-400 text-center py-4">
                Failed to load data
              </p>
            ) : messageTypes && messageTypes.length > 0 ? (
              <div className="space-y-2">
                {messageTypes.slice(0, 5).map((type) => (
                  <div
                    key={type.type}
                    className="flex items-center justify-between"
                  >
                    <Badge variant="secondary" className="capitalize">
                      {type.type}
                    </Badge>
                    <span className="text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                      {formatNumber(type.count)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
                No data available
              </p>
            )}
          </div>

          {/* Team Activity (Admin only) */}
          {isAdmin && (
            <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
                <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                  Team Activity
                </h3>
              </div>
              {isLoadingTeam ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : isTeamError ? (
                <p className="text-red-500 dark:text-red-400 text-center py-4">
                  Failed to load data
                </p>
              ) : teamStats && teamStats.length > 0 ? (
                <div className="space-y-3">
                  {teamStats.slice(0, 5).map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-gray-100 dark:bg-dark-tertiary dark:text-dark-text-secondary">
                            {member.email.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-gray-700 dark:text-dark-text-primary truncate max-w-[120px]">
                          {member.email}
                        </span>
                      </div>
                      <Badge variant="outline">
                        {formatNumber(member.messagesSent)} sent
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
                  No team activity
                </p>
              )}
            </div>
          )}
        </div>

        {/* Resolution Rate Analytics */}
        <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
            <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
              Resolution Rate
            </h3>
          </div>
          {isLoadingResolution ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : isResolutionError ? (
            <p className="text-red-500 dark:text-red-400 text-center py-4">
              Failed to load resolution data
            </p>
          ) : resolutionData?.data ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ResolutionStatCard
                icon={<CircleDot className="h-5 w-5" />}
                label="Open"
                value={resolutionData.data.openConversations}
                color="blue"
              />
              <ResolutionStatCard
                icon={<Clock className="h-5 w-5" />}
                label="Pending"
                value={resolutionData.data.pendingConversations}
                color="yellow"
              />
              <ResolutionStatCard
                icon={<CheckCircle className="h-5 w-5" />}
                label="Resolved"
                value={resolutionData.data.resolvedConversations}
                color="green"
              />
              <ResolutionStatCard
                icon={<Target className="h-5 w-5" />}
                label="Resolution Rate"
                value={resolutionData.data.resolutionRate}
                suffix="%"
                color="purple"
              />
            </div>
          ) : (
            <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
              No resolution data available
            </p>
          )}
        </div>

        {/* Customer Engagement Analytics */}
        <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
            <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
              Customer Engagement
            </h3>
          </div>
          {isLoadingEngagement ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
              <Skeleton className="h-48 w-full" />
            </div>
          ) : isEngagementError ? (
            <p className="text-red-500 dark:text-red-400 text-center py-4">
              Failed to load engagement data
            </p>
          ) : engagementData?.data ? (
            <div className="space-y-6">
              {/* Engagement Score Highlight */}
              <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-lg">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-white dark:bg-dark-secondary flex items-center justify-center shadow-sm">
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                      {engagementData.data.engagementScore}
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
                <EngagementStatCard
                  icon={<Activity className="h-5 w-5" />}
                  label="Active Contacts"
                  value={engagementData.data.activeContactsRate}
                  suffix="%"
                  detail={`${engagementData.data.activeContacts} of ${engagementData.data.totalContacts}`}
                  color="blue"
                />
                <EngagementStatCard
                  icon={<ArrowRightLeft className="h-5 w-5" />}
                  label="Two-Way Chats"
                  value={engagementData.data.twoWayConversationRate}
                  suffix="%"
                  detail={`${engagementData.data.twoWayConversations} conversations`}
                  color="green"
                />
                <EngagementStatCard
                  icon={<Reply className="h-5 w-5" />}
                  label="Response Rate"
                  value={engagementData.data.responseRate}
                  suffix="%"
                  detail={`${formatNumber(engagementData.data.messagesReceived)} inbound`}
                  color="purple"
                />
                <EngagementStatCard
                  icon={<Image className="h-5 w-5" />}
                  label="Media Engagement"
                  value={engagementData.data.mediaEngagementRate}
                  suffix="%"
                  detail={`${engagementData.data.conversationsWithMedia} with media`}
                  color="orange"
                />
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-3 gap-4 pt-2 border-t border-gray-100 dark:border-dark-border">
                <div className="text-center">
                  <p className="text-2xl font-semibold text-gray-900 dark:text-dark-text-primary">
                    {engagementData.data.averageMessagesPerContact}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Avg. messages per contact
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-green-600 dark:text-green-400">
                    {formatNumber(engagementData.data.messagesSent)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Messages sent
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-blue-600 dark:text-blue-400">
                    {formatNumber(engagementData.data.messagesReceived)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    Messages received
                  </p>
                </div>
              </div>

              {/* Engagement Trend Chart */}
              {!isLoadingEngagementTrend && engagementTrendData?.data && (
                <div className="pt-4 border-t border-gray-100 dark:border-dark-border">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-dark-text-primary mb-3">
                    Engagement Trend (Last 14 Days)
                  </h4>
                  <EngagementTrendChart data={engagementTrendData.data} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
              No engagement data available
            </p>
          )}
        </div>

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
