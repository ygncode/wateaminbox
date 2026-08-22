import { MessageSquare, Users } from "lucide-react";
import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { GroupList } from "../groups/GroupList";
import { ChatList } from "./ChatList";
import { useTranslation } from "react-i18next";

export type SidebarView = "chats" | "groups";

export interface ChatSidebarProps {
  selectedChatId?: string;
  onChatSelect: (chatId: string | null) => void;
  activeView: SidebarView;
  onActiveViewChange: (view: SidebarView) => void;
  className?: string;
}

/**
 * Chat sidebar where Chats contains every conversation and Groups is a
 * group-only filter, matching WhatsApp's inclusive conversation list.
 */
export const ChatSidebar = memo(function ChatSidebar({
  selectedChatId,
  onChatSelect,
  activeView,
  onActiveViewChange,
  className,
}: ChatSidebarProps) {
  const { t } = useTranslation();

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
      {/* Navigation Tabs - desktop only. Touch layouts switch the same filter
          from the floating bottom navigation, and showing both put two
          controls for one piece of state on a phone-sized screen. */}
      <div className="hidden h-14 min-h-[56px] items-stretch border-b border-gray-200 bg-gray-50 dark:border-dark-border dark:bg-dark-secondary md:h-[60px] md:min-h-[60px] lg:flex">
        <nav className="flex flex-1">
          <TabButton
            isActive={activeView === "chats"}
            onClick={() => onActiveViewChange("chats")}
            icon={<MessageSquare className="h-4 w-4" />}
            label={t("chat.tabChats", "Chats")}
          />
          <TabButton
            isActive={activeView === "groups"}
            onClick={() => onActiveViewChange("groups")}
            icon={<Users className="h-4 w-4" />}
            label={t("chat.groups", "Groups")}
          />
        </nav>
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
        "flex h-full flex-1 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors",
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
