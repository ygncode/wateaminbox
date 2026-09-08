import type { Channel } from "@wateaminbox/shared";
import type { ChannelAccount } from "@/lib/api/channel-accounts";
import { cn } from "@/lib/utils";

const channelPresentation: Record<
  Channel,
  { label: string; mark: string; className: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    mark: "WA",
    className:
      "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  },
  messenger: {
    label: "Messenger",
    mark: "M",
    className:
      "bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800",
  },
  instagram: {
    label: "Instagram",
    mark: "IG",
    className:
      "bg-pink-50 text-pink-800 ring-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:ring-pink-800",
  },
  telegram: {
    label: "Telegram",
    mark: "TG",
    className:
      "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800",
  },
  line: {
    label: "LINE",
    mark: "LI",
    className:
      "bg-lime-50 text-lime-800 ring-lime-200 dark:bg-lime-950/40 dark:text-lime-300 dark:ring-lime-800",
  },
  viber: {
    label: "Viber",
    mark: "VI",
    className:
      "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800",
  },
  email: {
    label: "Email",
    mark: "@",
    className:
      "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  },
};

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
        "inline-flex min-w-0 items-center rounded-full bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-200 dark:bg-dark-tertiary dark:text-dark-text-primary dark:ring-dark-border",
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
          connected ? "bg-emerald-500" : "bg-gray-400",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
