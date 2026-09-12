import type { Channel } from "@wateaminbox/shared";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import type { CustomerChat } from "@/lib/api/contacts";
import { cn } from "@/lib/utils";
import { ChannelAvatarBadge } from "./ChannelIdentity";

const KNOWN_CHANNELS: ReadonlySet<string> = new Set<Channel>([
  "whatsapp",
  "messenger",
  "instagram",
  "telegram",
  "line",
  "viber",
  "email",
]);

interface ChatIdentityAvatarProps {
  chat?: CustomerChat;
  /** Tailwind size utility for the avatar; the badge scales with it. */
  className?: string;
  badgeClassName?: string;
}

/**
 * A thread's face: its avatar with the channel it runs on marked on it.
 *
 * The channel is the part that matters here - two threads of one customer
 * differ by network before they differ by anything else - so it is drawn on
 * the avatar rather than beside the name where it can be truncated away.
 */
export function ChatIdentityAvatar({
  chat,
  className,
  badgeClassName,
}: ChatIdentityAvatarProps) {
  const label = chat?.displayName || chat?.address || "";
  return (
    <span className={cn("relative inline-flex size-5 shrink-0", className)}>
      <span className="size-full overflow-hidden rounded-full bg-gray-100 dark:bg-dark-tertiary">
        {chat?.avatarUrl ? (
          // The face is how two threads of one customer are told apart at a
          // glance; initials make every thread of a merged customer look the
          // same when the names match, which is exactly when they are merged.
          <img
            src={chat.avatarUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <IdentityAvatarFallback
            displayName={label}
            identity={chat?.chatId ?? label}
            className="text-[9px]"
          />
        )}
      </span>
      {chat && KNOWN_CHANNELS.has(chat.channel) && (
        <ChannelAvatarBadge
          channel={chat.channel as Channel}
          className={cn(
            "absolute -bottom-1 -right-1 size-3 ring-1",
            badgeClassName,
          )}
        />
      )}
    </span>
  );
}
