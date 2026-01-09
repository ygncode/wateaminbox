import {
  Clock,
  Inbox,
  MessageSquare,
  Send,
  UserCheck,
  Users,
} from "lucide-react";
import { StatCard } from "./StatCard";

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
}

/**
 * Overview stat cards for the dashboard
 * Shows total messages, contacts, active team, sent/received today, and unread count
 */
export function DashboardStats({ data, isLoading }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <StatCard
        icon={<MessageSquare className="h-5 w-5" />}
        label="Total Messages"
        value={data?.totalMessages}
        isLoading={isLoading}
      />
      <StatCard
        icon={<Users className="h-5 w-5" />}
        label="Total Contacts"
        value={data?.totalContacts}
        isLoading={isLoading}
      />
      <StatCard
        icon={<UserCheck className="h-5 w-5" />}
        label="Active Team"
        value={data?.activeUsers}
        isLoading={isLoading}
      />
      <StatCard
        icon={<Send className="h-5 w-5" />}
        label="Sent Today"
        value={data?.messagesSentToday}
        isLoading={isLoading}
        color="green"
      />
      <StatCard
        icon={<Inbox className="h-5 w-5" />}
        label="Received Today"
        value={data?.messagesReceivedToday}
        isLoading={isLoading}
        color="blue"
      />
      <StatCard
        icon={<Clock className="h-5 w-5" />}
        label="Unread"
        value={data?.unreadConversations}
        isLoading={isLoading}
        color="orange"
      />
    </div>
  );
}
