import type { Channel } from "@wateaminbox/shared";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCustomerChats } from "@/hooks/contact/useCustomerChats";
import type { CustomerChat } from "@/lib/api/contacts";
import { cn } from "@/lib/utils";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { ChannelAvatarBadge } from "./ChannelIdentity";

interface ChatSwitcherProps {
  /** The chat currently open, as the router addresses it. */
  currentChatId: string;
  onSelectChat: (chatId: string) => void;
}

const KNOWN_CHANNELS: ReadonlySet<string> = new Set<Channel>([
  "whatsapp",
  "messenger",
  "instagram",
  "telegram",
  "line",
  "viber",
  "email",
]);

/**
 * Whether the switcher has anything to offer.
 *
 * Extracted so the gate is testable on its own. One chat is the normal case
 * and must render nothing at all: a control that never has a second option is
 * noise in the most-used surface in the product.
 */
export function shouldOfferChatSwitcher(chats: CustomerChat[]): boolean {
  return chats.length > 1;
}

/**
 * A thread's face: its avatar with the channel it runs on marked on it.
 *
 * The channel is the part that matters here - two threads of one customer
 * differ by network before they differ by anything else - so it is drawn on
 * the avatar rather than beside the name where it can be truncated away.
 */
function ChatIdentityAvatar({ chat }: { chat?: CustomerChat }) {
  const label = chat?.displayName || chat?.address || "";
  return (
    <span className="relative inline-flex size-5 shrink-0">
      <span className="size-5 overflow-hidden rounded-full bg-gray-100 dark:bg-dark-tertiary">
        <IdentityAvatarFallback
          displayName={label}
          identity={chat?.chatId ?? label}
          className="text-[9px]"
        />
      </span>
      {chat && KNOWN_CHANNELS.has(chat.channel) && (
        <ChannelAvatarBadge
          channel={chat.channel as Channel}
          className="absolute -bottom-1 -right-1 size-3 ring-1"
        />
      )}
    </span>
  );
}

/**
 * Switch between the threads one customer is reachable on.
 *
 * Navigation, not routing: selecting a chat opens that conversation, which
 * already carries its own account and capabilities. It deliberately cannot
 * redirect a message from one thread onto another - a merge combines identity
 * and never combines conversations, so each thread keeps its own history,
 * assignment, and SLA clock.
 */
export function ChatSwitcher({
  currentChatId,
  onSelectChat,
}: ChatSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: chats = [] } = useCustomerChats(currentChatId);

  if (!shouldOfferChatSwitcher(chats)) return null;

  const current = chats.find((chat) => chat.chatId === currentChatId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 text-[11px] text-[#667781] transition-colors hover:bg-black/[0.04] dark:text-dark-text-secondary dark:hover:bg-white/[0.06]"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {/* The thread about to receive the reply, named and marked. A count
              said how many threads exist but not which one is armed, which is
              the only thing the operator needs before typing. */}
          <ChatIdentityAvatar chat={current} />
          <span className="max-w-40 truncate font-medium text-[#3b4a54] dark:text-dark-text-primary">
            {current
              ? current.displayName || current.address || currentChatId
              : t("chat.switcher.trigger", {
                  count: chats.length,
                  defaultValue: "{{count}} chats",
                })}
          </span>
          <ChevronDown
            className="size-3 shrink-0 opacity-60"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <p className="px-2 py-1.5 text-xs font-semibold text-[#3b4a54] dark:text-dark-text-primary">
          {t("chat.switcher.title", { defaultValue: "Switch chats" })}
        </p>
        <ul className="max-h-72 overflow-y-auto">
          {chats.map((chat) => {
            const isCurrent = chat.chatId === currentChatId;
            return (
              <li key={chat.chatId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!isCurrent) onSelectChat(chat.chatId);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                    isCurrent
                      ? "bg-black/[0.04] dark:bg-white/[0.06]"
                      : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
                  )}
                  aria-current={isCurrent ? "true" : undefined}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      isCurrent ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <ChatIdentityAvatar chat={chat} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[#111b21] dark:text-dark-text-primary">
                      {chat.displayName ||
                        chat.address ||
                        t("chat.switcher.unknownChat", {
                          defaultValue: "Chat",
                        })}
                    </span>
                    {chat.address && chat.displayName && (
                      <span className="block truncate text-[11px] text-[#667781] dark:text-dark-text-secondary">
                        {chat.address}
                      </span>
                    )}
                  </span>
                  {chat.unreadCount > 0 && !isCurrent && (
                    <span className="shrink-0 rounded-full bg-[#25d366] px-1.5 text-[10px] font-semibold text-white">
                      {chat.unreadCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {current?.accountName && (
          <p className="truncate px-2 pt-1.5 text-[11px] text-[#667781] dark:text-dark-text-secondary">
            {t("chat.switcher.sendingVia", {
              account: current.accountName,
              defaultValue: "Replying on {{account}}",
            })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
