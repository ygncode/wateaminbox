import { useState, useCallback } from "react";
import { ChatList } from "./ChatList";
import { GroupList } from "../groups/GroupList";
import { MessageSquare, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

type SidebarView = "chats" | "groups";

export interface ChatSidebarProps {
  selectedChatId?: string;
  onChatSelect: (chatId: string | null) => void;
  className?: string;
}

/**
 * Chat sidebar with tabs for Chats and Groups views
 */
export function ChatSidebar({
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
    <div className={cn("flex flex-col h-full bg-white", className)}>
      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50">
        <nav className="flex flex-1" role="tablist">
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
        {/* Settings */}
        <Link
          to="/settings"
          className="p-2.5 mr-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </Link>
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
}

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ isActive, onClick, icon, label }: TabButtonProps) {
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
          ? "text-whatsapp-teal-green border-whatsapp-teal-green bg-white"
          : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default ChatSidebar;
