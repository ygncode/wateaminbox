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
import { cn } from "@/lib/utils";
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
  description: string;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
  children: React.ReactNode;
}

function ChartPanel({
  icon,
  title,
  description,
  isLoading,
  isError,
  className,
  children,
}: ChartPanelProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-[#dce3de] bg-white p-4 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-5",
        className,
      )}
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e5f2ec] text-[#0b7a55] dark:bg-emerald-950/50 dark:text-emerald-300">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
            {description}
          </p>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-4">
          <div className="flex gap-4">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <Skeleton className="h-[220px] w-full rounded-xl" />
        </div>
      ) : isError ? (
        <div className="grid h-[276px] place-items-center rounded-xl border border-red-100 bg-red-50/60 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          This chart could not be loaded
        </div>
      ) : (
        children
      )}
    </section>
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <ChartPanel
        icon={<TrendingUp className="h-4 w-4" />}
        title="Message Trend"
        description="Daily inbound and outbound volume"
        isLoading={isLoadingMessages}
        isError={isMessagesError}
        className="xl:col-span-8"
      >
        <MessageChart data={messageData || []} />
      </ChartPanel>

      <ChartPanel
        icon={<UserPlus className="h-4 w-4" />}
        title="New Contacts"
        description="Acquisition and total contact growth"
        isLoading={isLoadingContactsTrend}
        isError={isContactsTrendError}
        className="xl:col-span-4"
      >
        <NewContactsChart data={contactsTrendData || []} />
      </ChartPanel>

      <ChartPanel
        icon={<Clock className="h-4 w-4" />}
        title="Hourly Activity"
        description="When your inbox is busiest across the day"
        isLoading={isLoadingHourly}
        isError={isHourlyError}
        className="xl:col-span-12"
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
  const maxMessageTypeCount = Math.max(
    ...(messageTypes?.map((type) => type.count) ?? []),
    1,
  );

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        isAdmin ? "xl:grid-cols-3" : "xl:grid-cols-2",
      )}
    >
      {/* Contact Stats */}
      <div className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5f2ec] text-[#0b7a55] dark:bg-emerald-950/50 dark:text-emerald-300">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
              Contact health
            </h3>
            <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
              Profile quality and ownership · all time
            </p>
          </div>
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
          <div>
            <div className="mb-5 rounded-xl bg-[#f4f8f5] px-4 py-3 dark:bg-dark-tertiary/60">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8881] dark:text-dark-text-secondary">
                Total contacts
              </p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-[#203b32] dark:text-dark-text-primary">
                {formatNumber(contactStats.total)}
              </p>
            </div>
            <div className="space-y-3.5">
              <StatRow
                label="Custom names"
                value={contactStats.withCustomName}
                total={contactStats.total}
              />
              <StatRow
                label="Tagged"
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
          </div>
        ) : (
          <p className="text-gray-500 dark:text-dark-text-secondary text-center py-4">
            No data available
          </p>
        )}
      </div>

      {/* Message Types */}
      <div className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eef1f7] text-[#48668b] dark:bg-blue-950/40 dark:text-blue-300">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
              Message mix
            </h3>
            <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
              Top formats in the selected period
            </p>
          </div>
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
          <div className="space-y-4">
            {messageTypes.slice(0, 5).map((type) => (
              <div key={type.type}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium capitalize text-[#4d5f58] dark:text-dark-text-secondary">
                    {type.type}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-[#203b32] dark:text-dark-text-primary">
                    {formatNumber(type.count)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1ee] dark:bg-dark-tertiary">
                  <div
                    className="h-full rounded-full bg-[#5682ad]"
                    style={{
                      width: `${(type.count / maxMessageTypeCount) * 100}%`,
                    }}
                  />
                </div>
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
        <div className="rounded-xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_1px_rgba(16,44,36,0.03)] dark:border-dark-border dark:bg-dark-elevated">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff3e2] text-[#b36c24] dark:bg-amber-950/40 dark:text-amber-300">
              <UserCheck className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[#203b32] dark:text-dark-text-primary">
                Team activity
              </h3>
              <p className="text-[11px] text-[#7a8881] dark:text-dark-text-secondary">
                Most active senders · all time
              </p>
            </div>
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
            <div className="space-y-1">
              {teamStats.slice(0, 5).map((member, index) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[#f5f8f6] dark:hover:bg-dark-tertiary/60"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="w-4 text-[10px] font-semibold tabular-nums text-[#9aa59f]">
                      {index + 1}
                    </span>
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-[#edf1ee] text-[10px] font-semibold text-[#4d5f58] dark:bg-dark-tertiary dark:text-dark-text-secondary">
                        {member.email.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-xs font-medium text-[#40544c] dark:text-dark-text-primary">
                      {member.email}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-[#e1e7e3] bg-[#fafcfb] text-[10px] tabular-nums dark:border-dark-border dark:bg-dark-secondary"
                  >
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
