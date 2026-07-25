import { MessageSquare, Settings, Users } from "lucide-react";
import { memo, useCallback, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { preloadRoute } from "@/lib/route-preload";
import { cn } from "@/lib/utils";
import { GroupList } from "../groups/GroupList";
import { ChatList } from "./ChatList";

export type SidebarView = "chats" | "groups";

export interface ChatSidebarProps {
  selectedChatId?: string;
  onChatSelect: (chatId: string | null) => void;
  activeView: SidebarView;
  onActiveViewChange: (view: SidebarView) => void;
  notificationAction?: ReactNode;
  panelHostRef?: Ref<HTMLDivElement>;
  className?: string;
}

/**
 * Chat sidebar with tabs for Chats and Groups views
 */
export const ChatSidebar = memo(function ChatSidebar({
  selectedChatId,
  onChatSelect,
  activeView,
  onActiveViewChange,
  notificationAction,
  panelHostRef,
  className,
}: ChatSidebarProps) {
  const handleGroupSelect = useCallback(
    (groupId: string) => {
      onChatSelect(groupId);
    },
    [onChatSelect],
  );

  return (
    <div
      ref={panelHostRef}
      className={cn(
        "relative flex flex-col h-full bg-white dark:bg-dark-secondary",
        className,
      )}
    >
      {/* Navigation Tabs */}
      <div className="flex h-14 min-h-[56px] items-stretch border-b border-gray-200 bg-gray-50 dark:border-dark-border dark:bg-dark-secondary md:h-[60px] md:min-h-[60px]">
        <nav className="flex flex-1">
          <TabButton
            isActive={activeView === "chats"}
            onClick={() => onActiveViewChange("chats")}
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chats"
          />
          <TabButton
            isActive={activeView === "groups"}
            onClick={() => onActiveViewChange("groups")}
            icon={<Users className="h-4 w-4" />}
            label="Groups"
          />
        </nav>
        {/* Notifications stay in the familiar conversation-list header. */}
        <div className="mr-2 flex items-center gap-1">
          {notificationAction}
          <Link
            to="/settings"
            className="p-2 text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors lg:hidden"
            aria-label="Settings"
            onMouseEnter={() => preloadRoute("settings")}
            onFocus={() => preloadRoute("settings")}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
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
