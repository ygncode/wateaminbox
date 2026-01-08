import type { Message } from "@whatsapp-web/shared";
import { forwardRef } from "react";
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

/**
 * Context menu for message actions
 */
export const MessageContextMenu = forwardRef<
  HTMLDivElement,
  MessageContextMenuProps
>(function MessageContextMenu(
  {
    message,
    position,
    onReply,
    onForward,
    onDelete,
    onStar,
    onReact,
    onClose,
  },
  ref,
) {
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
      className="absolute z-50 bg-white dark:bg-dark-elevated rounded-lg shadow-lg py-1 min-w-[140px]"
      style={{
        left: position.x,
        top: position.y,
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
