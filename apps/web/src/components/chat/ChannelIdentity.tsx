import type { Channel } from "@wateaminbox/shared";
import { MessagesSquare } from "lucide-react";
import type { ComponentType } from "react";
import {
  EmailMark,
  InstagramMark,
  LineMark,
  MessengerMark,
  TelegramMark,
  WhatsAppMark,
} from "@/components/connections/channel-icons";
import type { ChannelAccount } from "@/lib/api/channel-accounts";
import { cn } from "@/lib/utils";

const channelPresentation: Record<
  Channel,
  { label: string; mark: string; className: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    mark: "WA",
    className: "bg-muted text-fg-muted ring-line",
  },
  messenger: {
    label: "Messenger",
    mark: "M",
    className: "bg-muted text-fg-muted ring-line",
  },
  instagram: {
    label: "Instagram",
    mark: "IG",
    className: "bg-muted text-fg-muted ring-line",
  },
  telegram: {
    label: "Telegram",
    mark: "TG",
    className: "bg-muted text-fg-muted ring-line",
  },
  line: {
    label: "LINE",
    mark: "LI",
    className: "bg-muted text-fg-muted ring-line",
  },
  viber: {
    label: "Viber",
    mark: "VI",
    className: "bg-muted text-fg-muted ring-line",
  },
  email: {
    label: "Email",
    mark: "@",
    className: "bg-muted text-fg ring-line-strong",
  },
};

/**
 * The network's own name, for prose that would otherwise hardcode one.
 *
 * A merged customer's surviving record can be the Telegram one, so a label
 * reading "WhatsApp username" beside a Telegram handle is simply wrong. An
 * unknown channel yields null so the caller can drop the qualifier rather
 * than guess a network.
 */
export function channelLabel(
  channel: string | null | undefined,
): string | null {
  if (!channel) return null;
  return channelPresentation[channel as Channel]?.label ?? null;
}

/**
 * The provider's own mark and brand colour, for the avatar corner badge.
 *
 * `viber` has no entry because nothing draws its mark yet; callers fall back
 * to the lettered `ChannelBadge` for any channel missing here rather than
 * inventing a glyph.
 */
const channelBrand: Partial<
  Record<
    Channel,
    { Mark: ComponentType<{ className?: string }>; tileClassName: string }
  >
> = {
  whatsapp: {
    Mark: WhatsAppMark,
    tileClassName: "bg-brand-whatsapp text-white",
  },
  telegram: {
    Mark: TelegramMark,
    tileClassName: "bg-brand-telegram text-white",
  },
  messenger: {
    Mark: MessengerMark,
    tileClassName: "bg-brand-messenger text-white",
  },
  instagram: {
    Mark: InstagramMark,
    tileClassName:
      "bg-gradient-to-br from-brand-instagram-1 via-brand-instagram-2 to-brand-instagram-3 text-white",
  },
  line: { Mark: LineMark, tileClassName: "bg-brand-line text-white" },
  email: { Mark: EmailMark, tileClassName: "bg-fg-muted text-white" },
};

interface ChannelAvatarBadgeProps {
  channel: Channel;
  className?: string;
}

/**
 * The channel a conversation arrived on, badged onto its avatar.
 *
 * A row already spends its horizontal space on the name, the connection, and
 * the message preview; a lettered chip in that line competes with all three
 * for the one thing a glance needs - which app this is. Pinning the real mark
 * to the avatar answers that in the corner of the eye and gives the preview
 * its width back. The ring separates the tile from a same-coloured avatar.
 */
export function ChannelAvatarBadge({
  channel,
  className,
}: ChannelAvatarBadgeProps) {
  const brand = channelBrand[channel];
  const label = channelPresentation[channel].label;
  if (!brand) {
    return (
      <ChannelBadge channel={channel} compact iconOnly className={className} />
    );
  }
  const { Mark, tileClassName } = brand;
  return (
    <span
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full ring-2 ring-white",
        tileClassName,
        className,
      )}
      title={label}
      aria-label={`${label} channel`}
    >
      <Mark className="size-2.5" />
    </span>
  );
}

/**
 * The badge for a customer reachable on more than one channel.
 *
 * A merged customer has no single channel to mark, and picking one of theirs
 * would be a lie that changes with whichever thread spoke last. The product
 * mark says what is true: this row is the inbox's own view of a person, not
 * one network's.
 */
export function MergedCustomerAvatarBadge({
  className,
  channelCount,
}: {
  className?: string;
  channelCount: number;
}) {
  return (
    <span
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full bg-signal text-on-signal ring-2 ring-surface",
        className,
      )}
      title={`Reachable on ${channelCount} channels`}
      aria-label={`Reachable on ${channelCount} channels`}
    >
      <MessagesSquare className="size-2.5" strokeWidth={2.5} />
    </span>
  );
}

interface ChannelBadgeProps {
  channel: Channel;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
}

/** Small, provider-independent channel identity for inbox routing surfaces. */
export function ChannelBadge({
  channel,
  compact = false,
  iconOnly = false,
  className,
}: ChannelBadgeProps) {
  const presentation = channelPresentation[channel];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold ring-1 ring-inset",
        presentation.className,
        compact
          ? "gap-1 px-1.5 py-0.5 text-[10px]"
          : "gap-1.5 px-2 py-1 text-xs",
        iconOnly && "size-5 justify-center p-0 text-[8px]",
        className,
      )}
      title={presentation.label}
      aria-label={`${presentation.label} channel`}
    >
      <span aria-hidden="true">{presentation.mark}</span>
      {!iconOnly && <span>{presentation.label}</span>}
    </span>
  );
}

interface ChannelAccountBadgeProps {
  account: Pick<
    ChannelAccount,
    "id" | "channel" | "displayName" | "externalAccountId" | "status"
  >;
  compact?: boolean;
  className?: string;
}

/** Account badge shared by future channel-neutral list, header, and settings UI. */
export function ChannelAccountBadge({
  account,
  compact = false,
  className,
}: ChannelAccountBadgeProps) {
  const connected = account.status === "connected";
  const label =
    account.displayName || account.externalAccountId || "Channel account";
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center rounded-full bg-muted text-fg ring-1 ring-inset ring-line-strong",
        compact
          ? "gap-1 px-1.5 py-0.5 text-[10px]"
          : "gap-1.5 px-2 py-1 text-xs",
        className,
      )}
      title={`${label} · ${account.status}`}
      aria-label={`${channelPresentation[account.channel].label} account: ${label}, ${account.status}`}
    >
      <ChannelBadge channel={account.channel} compact iconOnly />
      <span className="truncate font-semibold">{label}</span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-primary" : "bg-fg-subtle",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
