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

/** Optional translator so this stays unit-testable outside React. */
export type UnreadTranslate = (
  key: string,
  options: { defaultValue: string } & Record<string, unknown>,
) => string;

const englishUnread: UnreadTranslate = (_key, options) =>
  options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    String(options[name] ?? ""),
  );

export function getInboxNavigationLabel(
  label: string,
  unreadCount: number,
  t: UnreadTranslate = englishUnread,
): string {
  if (unreadCount <= 0) return label;
  return t("nav.inboxUnread", {
    defaultValue:
      unreadCount === 1
        ? "{{label}}, {{count}} unread message"
        : "{{label}}, {{count}} unread messages",
    label,
    count: unreadCount,
  });
}
