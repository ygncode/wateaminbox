import { MessageSquare, Settings } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";
import { preloadRoute } from "@/lib/route-preload";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface ChatNavigationRailProps {
  onChatsClick: () => void;
}

/** Fixed desktop navigation rail inspired by WhatsApp Desktop. */
export const ChatNavigationRail = memo(function ChatNavigationRail({
  onChatsClick,
}: ChatNavigationRailProps) {
  return (
    <nav
      className="flex h-full w-16 flex-none flex-col items-center border-r border-gray-200 bg-gray-50 py-3 dark:border-dark-border dark:bg-dark-secondary"
      aria-label="Primary navigation"
    >
      <button
        type="button"
        onClick={onChatsClick}
        aria-label="Chats"
        aria-current="page"
        title="Chats"
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-teal-green focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark-secondary",
          "bg-whatsapp-teal-green/15 text-whatsapp-teal-green",
        )}
      >
        <span
          className="absolute -left-[11px] h-7 w-1 rounded-r-full bg-whatsapp-teal-green"
          aria-hidden="true"
        />
        <MessageSquare className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="mt-auto flex flex-col items-center gap-2">
        <ThemeToggle className="rounded-xl md:h-11 md:w-11" />

        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          onMouseEnter={() => preloadRoute("settings")}
          onFocus={() => preloadRoute("settings")}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-teal-green focus-visible:ring-offset-2 dark:text-dark-text-secondary dark:hover:bg-dark-tertiary dark:hover:text-dark-text-primary dark:focus-visible:ring-offset-dark-secondary"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
});

export default ChatNavigationRail;
