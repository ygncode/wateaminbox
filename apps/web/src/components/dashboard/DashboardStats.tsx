import {
  Clock,
  Inbox,
  MessageSquare,
  Send,
  UserCheck,
  Users,
} from "lucide-react";
import { StatCard } from "./StatCard";
import { useTranslation } from "react-i18next";

export interface DashboardStatsData {
  totalMessages?: number;
  totalContacts?: number;
  activeUsers?: number;
  messagesSentToday?: number;
  messagesReceivedToday?: number;
  unreadConversations?: number;
}

export interface DashboardStatsProps {
  data: DashboardStatsData | undefined;
  isLoading: boolean;
  isError?: boolean;
}

/**
 * Overview stat cards for the dashboard
 * Shows total messages, contacts, active team, sent/received today, and unread count
 */
export function DashboardStats({
  data,
  isLoading,
  isError = false,
}: DashboardStatsProps) {
  const { t } = useTranslation();

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      >
        {t(
          "dashboard.statsLoadFailed",
          "We couldn’t load the operational overview. Please try again shortly.",
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={<MessageSquare className="h-5 w-5" />}
        label={t("dashboard.totalMessages", "Total Messages")}
        value={data?.totalMessages}
        isLoading={isLoading}
      />
      <StatCard
        icon={<Users className="h-5 w-5" />}
        label={t("dashboard.totalContacts", "Total Contacts")}
        value={data?.totalContacts}
        isLoading={isLoading}
      />
      <StatCard
        icon={<UserCheck className="h-5 w-5" />}
        label={t("dashboard.teamMembers", "Team Members")}
        value={data?.activeUsers}
        isLoading={isLoading}
      />
      <StatCard
        icon={<Send className="h-5 w-5" />}
        label={t("dashboard.sentToday", "Sent Today")}
        value={data?.messagesSentToday}
        isLoading={isLoading}
        color="green"
      />
      <StatCard
        icon={<Inbox className="h-5 w-5" />}
        label={t("dashboard.receivedToday", "Received Today")}
        value={data?.messagesReceivedToday}
        isLoading={isLoading}
        color="blue"
      />
      <StatCard
        icon={<Clock className="h-5 w-5" />}
        label={t("dashboard.unread", "Unread")}
        value={data?.unreadConversations}
        isLoading={isLoading}
        color="orange"
      />
    </div>
  );
}
