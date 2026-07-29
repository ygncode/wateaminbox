import type { Chat } from "../../types/chat";

type ChatUnreadState = Pick<Chat, "unreadCount">;

/** Sum the unread messages represented by the workspace conversation cache. */
export function getInboxUnreadCount(
  chats: readonly ChatUnreadState[] | undefined,
): number {
  return (
    chats?.reduce((total, chat) => total + Math.max(0, chat.unreadCount), 0) ??
    0
  );
}

export function formatInboxUnreadCount(unreadCount: number): string {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function getInboxNavigationLabel(
  label: string,
  unreadCount: number,
): string {
  if (unreadCount <= 0) return label;
  return `${label}, ${unreadCount} unread message${
    unreadCount === 1 ? "" : "s"
  }`;
}
