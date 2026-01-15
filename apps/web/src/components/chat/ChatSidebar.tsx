import { MessageSquare, Settings, Users } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { GroupList } from "../groups/GroupList";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { ChatList } from "./ChatList";

type SidebarView = "chats" | "groups";

export interface ChatSidebarProps {
  selectedChatId?: string;
  onChatSelect: (chatId: string | null) => void;
  className?: string;
}

/**
 * Chat sidebar with tabs for Chats and Groups views
 */
export const ChatSidebar = memo(function ChatSidebar({
  selectedChatId,
  onChatSelect,
  className,
}: ChatSidebarProps) {
  const [activeView, setActiveView] = useState<SidebarView>("chats");

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      onChatSelect(groupId);
    },
    [onChatSelect],
  );

  return (
    <div
      className={cn(
        "relative flex flex-col h-full bg-white dark:bg-dark-secondary",
        className,
      )}
    >
      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary">
        <nav className="flex flex-1">
          <TabButton
            isActive={activeView === "chats"}
            onClick={() => setActiveView("chats")}
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chats"
          />
          <TabButton
            isActive={activeView === "groups"}
            onClick={() => setActiveView("groups")}
            icon={<Users className="h-4 w-4" />}
            label="Groups"
          />
        </nav>
        {/* Notifications & Settings */}
        <div className="flex items-center gap-1 mr-2">
          <NotificationCenter />
          <Link
            to="/settings"
            className="p-2 text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* View Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === "chats" && (
          <ChatList
            selectedChatId={selectedChatId}
            onChatSelect={onChatSelect}
          />
        )}
        {activeView === "groups" && (
          <GroupList
            selectedGroupId={selectedChatId}
            onGroupSelect={handleGroupSelect}
          />
        )}
      </div>
    </div>
  );
});

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const TabButton = memo(function TabButton({
  isActive,
  onClick,
  icon,
  label,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
        "border-b-2 -mb-px",
        isActive
          ? "text-whatsapp-teal-green border-whatsapp-teal-green bg-white dark:bg-dark-elevated"
          : "text-gray-500 dark:text-dark-text-secondary border-transparent hover:text-gray-700 dark:hover:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
});

export default ChatSidebar;
