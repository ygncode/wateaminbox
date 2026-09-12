import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RightPanelSection } from "@/components/layout/right-panel";
import { useCustomerChats } from "@/hooks/contact/useCustomerChats";
import type { CustomerChat } from "@/lib/api/contacts";
import { cn } from "@/lib/utils";
import { ChatIdentityAvatar } from "../ChatIdentityAvatar";
import type { ContactData } from "./types";

interface MergedChatsSectionProps {
  contact: ContactData;
  /** Open one of these threads. Absent where the host cannot switch chats. */
  onSelectThread?: (chatId: string) => void;
  /** Whether the merge tools below are currently unfolded. */
  isManaging: boolean;
  onToggleManage: () => void;
  /** Whether this viewer may merge or separate at all. */
  canManage: boolean;
}

/**
 * Whether this section has anything to show.
 *
 * Extracted so the gate is testable on its own. A single-thread customer is
 * the normal case: it earns a section only because the merge tools live
 * behind it, so a viewer who may not merge sees nothing at all.
 */
export function shouldShowMergedChats(input: {
  chatCount: number;
  canManage: boolean;
}): boolean {
  return input.chatCount > 1 || input.canManage;
}

/**
 * Which threads a customer is reachable on, listed in one place.
 *
 * A merge combines identity and never combines conversations, so the customer
 * keeps several threads and the panel has to say so plainly - otherwise the
 * only evidence of a merge is a history entry phrased as an audit record, and
 * an operator cannot tell what they are actually looking at. The channel is
 * carried on each avatar because that is the difference a glance is after.
 *
 * The merge tools fold in behind "Manage" rather than standing as three
 * stacked sections of their own: merging is occasional, and the everyday
 * question is only which chats exist. Suggestions stay outside this fold, as
 * they are evidence the operator has not asked for yet.
 */
export function MergedChatsSection({
  contact,
  onSelectThread,
  isManaging,
  onToggleManage,
  canManage,
}: MergedChatsSectionProps) {
  const { t } = useTranslation();
  const { data: chats = [] } = useCustomerChats(contact.id);

  if (!shouldShowMergedChats({ chatCount: chats.length, canManage })) {
    return null;
  }

  const merged = chats.length > 1;

  return (
    <RightPanelSection
      title={
        merged
          ? t("contacts.mergedChatsTitle", "Merged chats")
          : t("contacts.chatsTitle", "Chats")
      }
      titleAction={
        canManage ? (
          <button
            type="button"
            onClick={onToggleManage}
            aria-expanded={isManaging}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-whatsapp-teal-green hover:underline"
          >
            {t("contacts.manageMerges", "Manage")}
            {isManaging ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-gray-50 dark:divide-dark-border dark:bg-dark-tertiary/40">
        {chats.map((chat) => (
          <li key={chat.chatId}>
            <ThreadRow chat={chat} onSelect={onSelectThread} />
          </li>
        ))}
        {chats.length === 0 && (
          <li className="px-2.5 py-2 text-xs text-gray-500 dark:text-dark-text-tertiary">
            {t("contacts.noChatsYet", "No conversations yet")}
          </li>
        )}
      </ul>
    </RightPanelSection>
  );
}

function ThreadRow({
  chat,
  onSelect,
}: {
  chat: CustomerChat;
  onSelect?: (chatId: string) => void;
}) {
  const { t } = useTranslation();
  const name =
    chat.displayName ||
    chat.address ||
    t("chat.switcher.unknownChat", { defaultValue: "Chat" });
  const secondary = chat.accountName || chat.address;

  const body = (
    <>
      <ChatIdentityAvatar chat={chat} className="size-7" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-dark-text-primary">
          {name}
        </span>
        {secondary && secondary !== name && (
          <span className="block truncate text-[11px] text-gray-500 dark:text-dark-text-tertiary">
            {secondary}
          </span>
        )}
      </span>
      {chat.unreadCount > 0 && (
        <span className="shrink-0 rounded-full bg-[#25d366] px-1.5 text-[10px] font-semibold text-white">
          {chat.unreadCount}
        </span>
      )}
    </>
  );

  const className = "flex w-full items-center gap-2.5 px-2.5 py-2 text-left";
  if (!onSelect) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onSelect(chat.chatId)}
      className={cn(
        className,
        "transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
      )}
    >
      {body}
    </button>
  );
}
