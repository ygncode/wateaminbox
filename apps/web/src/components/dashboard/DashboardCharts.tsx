import {
  BarChart3,
  Clock,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/hooks/analytics";
import { HourlyChart, MessageChart, NewContactsChart } from "./charts";
import { StatRow } from "./StatRow";

// =====================
// Types
// =====================

export interface MessageDataPoint {
  date: string;
  sent: number;
  received: number;
}

export interface ContactTrendDataPoint {
  date: string;
  count: number;
  cumulativeTotal: number;
}

export interface HourlyDataPoint {
  hour: number;
  count: number;
}

export interface ContactStatsData {
  total: number;
  withCustomName: number;
  withTags: number;
  assigned: number;
  unassigned: number;
}

export interface MessageTypeData {
  type: string;
  count: number;
}

export interface TeamMemberData {
  userId: string;
  email: string;
  messagesSent: number;
}

// =====================
// Chart Panel Component
// =====================

interface ChartPanelProps {
  icon: React.ReactNode;
  title: string;
  isLoading: boolean;
  isError?: boolean;
  children: React.ReactNode;
}

function ChartPanel({
  icon,
  title,
  isLoading,
  isError,
  children,
}: ChartPanelProps) {
  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-gray-500 dark:text-dark-text-secondary">
          {icon}
        </span>
        <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
          {title}
        </h3>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <p className="text-red-500 dark:text-red-400 text-center py-8">
          Failed to load data
        </p>
      ) : (
        children
      )}
    </div>
  );
}

// =====================
// Trend Charts Row
// =====================

export interface TrendChartsRowProps {
  messageData: MessageDataPoint[] | undefined;
  isLoadingMessages: boolean;
  isMessagesError: boolean;
  contactsTrendData: ContactTrendDataPoint[] | undefined;
  isLoadingContactsTrend: boolean;
  isContactsTrendError: boolean;
  hourlyStats: HourlyDataPoint[] | undefined;
  isLoadingHourly: boolean;
  isHourlyError: boolean;
}

export function TrendChartsRow({
  messageData,
  isLoadingMessages,
  isMessagesError,
  contactsTrendData,
  isLoadingContactsTrend,
  isContactsTrendError,
  hourlyStats,
  isLoadingHourly,
  isHourlyError,
}: TrendChartsRowProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <ChartPanel
        icon={<TrendingUp className="h-5 w-5" />}
        title="Message Trend"
        isLoading={isLoadingMessages}
        isError={isMessagesError}
      >
        <MessageChart data={messageData || []} />
      </ChartPanel>

      <ChartPanel
        icon={<UserPlus className="h-5 w-5" />}
        title="New Contacts"
        isLoading={isLoadingContactsTrend}
        isError={isContactsTrendError}
      >
        <NewContactsChart data={contactsTrendData || []} />
      </ChartPanel>

      <ChartPanel
        icon={<Clock className="h-5 w-5" />}
        title="Hourly Activity"
        isLoading={isLoadingHourly}
        isError={isHourlyError}
      >
        <HourlyChart data={hourlyStats || []} />
      </ChartPanel>
    </div>
  );
}

// =====================
// Stats Cards Row
// =====================

export interface StatsCardsRowProps {
  contactStats: ContactStatsData | undefined;
  isLoadingContacts: boolean;
  isContactsError: boolean;
  messageTypes: MessageTypeData[] | undefined;
  isLoadingTypes: boolean;
  isTypesError: boolean;
  teamStats: TeamMemberData[] | undefined;
  isLoadingTeam: boolean;
  isTeamError: boolean;
  isAdmin: boolean;
}

export function StatsCardsRow({
  contactStats,
  isLoadingContacts,
  isContactsError,
  messageTypes,
  isLoadingTypes,
  isTypesError,
  teamStats,
  isLoadingTeam,
  isTeamError,
  isAdmin,
}: StatsCardsRowProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Contact Stats */}
      <div className="bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
          <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">
            Contact Stats
          </h3>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            All time
          </span>
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
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              All time
            </span>
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
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="text-xs bg-gray-100 dark:bg-dark-tertiary dark:text-dark-text-secondary">
                        {member.email.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-gray-700 dark:text-dark-text-primary truncate">
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
  );
}
