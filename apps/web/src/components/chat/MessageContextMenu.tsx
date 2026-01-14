import { useQueryClient } from "@tanstack/react-query";
import type { Message } from "@whatsapp-web/shared";
import { forwardRef, useEffect, useMemo } from "react";
import { prefetchForwardContacts } from "@/hooks/useForwardContacts";
import {
  DeleteIcon,
  EmojiIcon,
  ForwardIcon,
  ReplyIcon,
  StarIcon,
} from "./MessageIcons";

interface ContextMenuItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

interface MessageContextMenuProps {
  message: Message;
  position: { x: number; y: number };
  onReply?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onStar?: (message: Message) => void;
  onReact: () => void;
  onClose: () => void;
}

// Menu dimensions for boundary calculations
const MENU_WIDTH = 140;
const MENU_HEIGHT = 200; // Approximate height for 5 items
const VIEWPORT_PADDING = 10;

/**
 * Context menu for message actions
 * Uses fixed positioning with viewport boundary detection
 */
export const MessageContextMenu = forwardRef<
  HTMLDivElement,
  MessageContextMenuProps
>(function MessageContextMenu(
  { message, position, onReply, onForward, onDelete, onStar, onReact, onClose },
  ref,
) {
  const queryClient = useQueryClient();

  // Prefetch forward contacts when context menu opens
  // This gives us a head start before user clicks "Forward"
  useEffect(() => {
    prefetchForwardContacts(queryClient);
  }, [queryClient]);

  // Calculate adjusted position synchronously during render
  const adjustedPosition = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    // Check right boundary
    if (x + MENU_WIDTH > viewportWidth - VIEWPORT_PADDING) {
      x = viewportWidth - MENU_WIDTH - VIEWPORT_PADDING;
    }

    // Check left boundary
    if (x < VIEWPORT_PADDING) {
      x = VIEWPORT_PADDING;
    }

    // Check bottom boundary
    if (y + MENU_HEIGHT > viewportHeight - VIEWPORT_PADDING) {
      y = viewportHeight - MENU_HEIGHT - VIEWPORT_PADDING;
    }

    // Check top boundary
    if (y < VIEWPORT_PADDING) {
      y = VIEWPORT_PADDING;
    }

    return { x, y };
  }, [position.x, position.y]);

  const menuItems: ContextMenuItem[] = [
    { label: "React", icon: EmojiIcon, action: onReact },
    { label: "Reply", icon: ReplyIcon, action: () => onReply?.(message) },
    { label: "Forward", icon: ForwardIcon, action: () => onForward?.(message) },
    {
      label: message.isStarred ? "Unstar" : "Star",
      icon: StarIcon,
      action: () => onStar?.(message),
    },
    { label: "Delete", icon: DeleteIcon, action: () => onDelete?.(message) },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-white dark:bg-dark-elevated rounded-lg shadow-xl py-1 min-w-[140px] border border-gray-200 dark:border-dark-border"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      {menuItems.map((item) => (
        <button
          key={item.label}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
          onClick={() => {
            item.action();
            onClose();
          }}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </button>
      ))}
    </div>
  );
});
