import { useState } from "react";
import {
  useDashboardStats,
  useMessageStats,
  useContactStats,
  useTeamActivityStats,
  useMessageTypeStats,
  useHourlyStats,
  useNewContactsTrend,
  useResolutionStats,
  formatNumber,
  formatDate,
} from "@/hooks/useAnalytics";
import {
  Button,
  Badge,
  Skeleton,
  Avatar,
  AvatarFallback,
} from "@/components/ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExportDialog } from "@/components/export";
import { ResponseTimeAnalytics } from "./ResponseTimeAnalytics";
import {
  MessageSquare,
  Users,
  UserCheck,
  Send,
  Inbox,
  Clock,
  TrendingUp,
  BarChart3,
  Download,
  Archive,
  UserPlus,
  CheckCircle,
  CircleDot,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    const end = new Date();
    const start = new Date();
    if (dateRange === "7d") start.setDate(start.getDate() - 7);
    else if (dateRange === "30d") start.setDate(start.getDate() - 30);
    else start.setDate(start.getDate() - 90);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  };

  const { startDate, endDate } = getDates();

  const { data: dashboardStats, isLoading: isLoadingDashboard } =
    useDashboardStats(companyId);
  const { data: messageData, isLoading: isLoadingMessages } = useMessageStats(
    companyId,
    startDate,
    endDate,
  );
  const { data: contactStats, isLoading: isLoadingContacts } =
    useContactStats(companyId);
  const { data: messageTypes, isLoading: isLoadingTypes } =
    useMessageTypeStats(companyId);
  const { data: hourlyStats, isLoading: isLoadingHourly } =
    useHourlyStats(companyId);
  const { data: teamStats, isLoading: isLoadingTeam } = useTeamActivityStats(
    isAdmin ? companyId : null,
  );
  const { data: contactsTrendData, isLoading: isLoadingContactsTrend } =
    useNewContactsTrend(companyId, startDate, endDate);
  const { data: resolutionData, isLoading: isLoadingResolution } =
    useResolutionStats(companyId, startDate, endDate);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
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
            <div className="w-px bg-gray-200 mx-1" />
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
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">Message Trend</h3>
            </div>
            {isLoadingMessages ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <MessageChart data={messageData?.data || []} />
            )}
          </div>

          {/* New Contacts Trend */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">New Contacts</h3>
            </div>
            {isLoadingContactsTrend ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <NewContactsChart data={contactsTrendData?.data || []} />
            )}
          </div>

          {/* Hourly Distribution */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">Hourly Activity</h3>
            </div>
            {isLoadingHourly ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <HourlyChart data={hourlyStats || []} />
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact Stats */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">Contact Stats</h3>
            </div>
            {isLoadingContacts ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
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
            ) : null}
          </div>

          {/* Message Types */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">Message Types</h3>
            </div>
            {isLoadingTypes ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {messageTypes?.slice(0, 5).map((type) => (
                  <div
                    key={type.type}
                    className="flex items-center justify-between"
                  >
                    <Badge variant="secondary" className="capitalize">
                      {type.type}
                    </Badge>
                    <span className="text-sm font-medium text-gray-700">
                      {formatNumber(type.count)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team Activity (Admin only) */}
          {isAdmin && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="h-5 w-5 text-gray-500" />
                <h3 className="font-semibold text-gray-900">Team Activity</h3>
              </div>
              {isLoadingTeam ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  {teamStats?.slice(0, 5).map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-gray-100">
                            {member.email.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-gray-700 truncate max-w-[120px]">
                          {member.email}
                        </span>
                      </div>
                      <Badge variant="outline">
                        {formatNumber(member.messagesSent)} sent
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Resolution Rate Analytics */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Resolution Rate</h3>
          </div>
          {isLoadingResolution ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
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
            <p className="text-gray-500 text-center py-4">No resolution data available</p>
          )}
        </div>

        {/* Response Time Analytics */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <ResponseTimeAnalytics isAdmin={isAdmin} slaThreshold={60} />
        </div>
      </div>
    </ScrollArea>
  );
}

/**
 * Stat card component
 */
function StatCard({
  icon,
  label,
  value,
  isLoading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  isLoading: boolean;
  accent?: "green" | "blue" | "orange";
}) {
  const accentColors = {
    green: "text-green-600 bg-green-50",
    blue: "text-blue-600 bg-blue-50",
    orange: "text-orange-600 bg-orange-50",
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center mb-3",
          accent ? accentColors[accent] : "text-gray-500 bg-gray-100",
        )}
      >
        {icon}
      </div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      {isLoading ? (
        <Skeleton className="h-7 w-16 mt-1" />
      ) : (
        <p className="text-2xl font-semibold text-gray-900">
          {value !== undefined ? formatNumber(value) : "-"}
        </p>
      )}
    </div>
  );
}

/**
 * Stat row for bar-style display
 */
function StatRow({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-whatsapp-teal-green rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Simple message trend chart (bar chart)
 */
function MessageChart({
  data,
}: {
  data: { date: string; sent: number; received: number }[];
}) {
  if (data.length === 0) {
    return <p className="text-gray-500 text-center py-8">No data available</p>;
  }

  const maxValue = Math.max(...data.flatMap((d) => [d.sent, d.received]));

  return (
    <div className="h-48 flex items-end gap-1">
      {data.slice(-14).map((day, i) => {
        const sentHeight = maxValue > 0 ? (day.sent / maxValue) * 100 : 0;
        const receivedHeight =
          maxValue > 0 ? (day.received / maxValue) * 100 : 0;

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1"
            title={formatDate(day.date)}
          >
            <div
              className="w-full flex gap-0.5 items-end"
              style={{ height: "160px" }}
            >
              <div
                className="flex-1 bg-green-400 rounded-t transition-all"
                style={{ height: `${sentHeight}%` }}
              />
              <div
                className="flex-1 bg-blue-400 rounded-t transition-all"
                style={{ height: `${receivedHeight}%` }}
              />
            </div>
            {i === 0 || i === data.slice(-14).length - 1 ? (
              <span className="text-[10px] text-gray-400">
                {formatDate(day.date)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Hourly activity chart
 */
function HourlyChart({ data }: { data: { hour: number; count: number }[] }) {
  if (data.length === 0) {
    return <p className="text-gray-500 text-center py-8">No data available</p>;
  }

  const maxValue = Math.max(...data.map((d) => d.count));

  return (
    <div className="h-48 flex items-end gap-0.5">
      {data.map((hour) => {
        const height = maxValue > 0 ? (hour.count / maxValue) * 100 : 0;

        return (
          <div
            key={hour.hour}
            className="flex-1 flex flex-col items-center"
            title={`${hour.hour}:00 - ${hour.count} messages`}
          >
            <div className="w-full flex items-end" style={{ height: "140px" }}>
              <div
                className="w-full bg-whatsapp-teal-green rounded-t transition-all hover:bg-whatsapp-dark-green"
                style={{ height: `${height}%` }}
              />
            </div>
            {hour.hour % 6 === 0 && (
              <span className="text-[10px] text-gray-400 mt-1">
                {hour.hour}:00
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * New contacts trend chart with bar and cumulative line
 */
function NewContactsChart({
  data,
}: {
  data: { date: string; count: number; cumulativeTotal: number }[];
}) {
  if (data.length === 0) {
    return <p className="text-gray-500 text-center py-8">No data available</p>;
  }

  // Get last 14 days for display
  const displayData = data.slice(-14);
  const maxCount = Math.max(...displayData.map((d) => d.count));
  const totalNew = displayData.reduce((sum, d) => sum + d.count, 0);
  const latestCumulative = displayData[displayData.length - 1]?.cumulativeTotal || 0;

  return (
    <div className="h-48">
      {/* Summary stats */}
      <div className="flex justify-between text-xs text-gray-500 mb-2">
        <span>
          <span className="font-medium text-purple-600">+{totalNew}</span> new
        </span>
        <span>
          Total: <span className="font-medium text-gray-700">{formatNumber(latestCumulative)}</span>
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-36">
        {displayData.map((day, i) => {
          const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center"
              title={`${formatDate(day.date)}: ${day.count} new (Total: ${day.cumulativeTotal})`}
            >
              <div
                className="w-full flex items-end"
                style={{ height: "120px" }}
              >
                <div
                  className={cn(
                    "w-full rounded-t transition-all",
                    day.count > 0
                      ? "bg-purple-400 hover:bg-purple-500"
                      : "bg-gray-100",
                  )}
                  style={{ height: `${Math.max(height, day.count > 0 ? 5 : 0)}%` }}
                />
              </div>
              {i === 0 || i === displayData.length - 1 ? (
                <span className="text-[10px] text-gray-400 mt-1">
                  {formatDate(day.date)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Resolution stat card component
 */
function ResolutionStatCard({
  icon,
  label,
  value,
  suffix,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
  color: "blue" | "yellow" | "green" | "purple";
}) {
  const colorClasses = {
    blue: "text-blue-600 bg-blue-50",
    yellow: "text-yellow-600 bg-yellow-50",
    green: "text-green-600 bg-green-50",
    purple: "text-purple-600 bg-purple-50",
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            colorClasses[color],
          )}
        >
          {icon}
        </div>
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-gray-900">
        {formatNumber(value)}
        {suffix}
      </p>
    </div>
  );
}

export default Dashboard;
