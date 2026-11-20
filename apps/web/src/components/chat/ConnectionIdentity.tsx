import type { WhatsAppConnectionIdentity } from "@wateaminbox/shared";
import { Radio, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { cn, formatPhoneLikeText } from "@/lib/utils";

const accountColors = [
  {
    dot: "bg-id-6",
    tint: "bg-id-6-soft text-id-6 ring-id-6/25",
  },
  {
    dot: "bg-id-1",
    tint: "bg-id-1-soft text-id-1 ring-id-1/25",
  },
  {
    dot: "bg-id-2",
    tint: "bg-id-2-soft text-id-2 ring-id-2/25",
  },
  {
    dot: "bg-id-4",
    tint: "bg-id-4-soft text-id-4 ring-id-4/25",
  },
  {
    dot: "bg-id-3",
    tint: "bg-id-3-soft text-id-3 ring-id-3/25",
  },
] as const;

function hashIdentity(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

export function getConnectionColor(connectionId: string) {
  return accountColors[hashIdentity(connectionId) % accountColors.length];
}

export function getConnectionLabel(connection: {
  name?: string | null;
  phoneNumber?: string | null;
}): string {
  return formatPhoneLikeText(
    connection.name || connection.phoneNumber || i18n.t("chat.whatsappAccount"),
  );
}

export function getConnectionPhone(connection: {
  phoneNumber?: string | null;
}): string | null {
  return connection.phoneNumber
    ? formatPhoneLikeText(connection.phoneNumber)
    : null;
}

interface ConnectionBadgeProps {
  connection: WhatsAppConnectionIdentity;
  compact?: boolean;
  className?: string;
}

/** Consistent account identity used anywhere a conversation route is shown. */
export function ConnectionBadge({
  connection,
  compact = false,
  className,
}: ConnectionBadgeProps) {
  const { t } = useTranslation();
  const color = getConnectionColor(connection.id);
  const label = getConnectionLabel(connection);
  const phone = getConnectionPhone(connection);
  const isConnected = connection.status === "connected";
  const identity = `${label}${phone && phone !== label ? ` · ${phone}` : ""}`;
  const title = t("chat.connectionBadgeTitle", {
    identity,
    status: isConnected
      ? t("connections.connected")
      : t("chat.accountDisconnected"),
  });

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center rounded-full ring-1 ring-inset",
        color.tint,
        compact
          ? "gap-1 px-1.5 py-0.5 text-[10px]"
          : "gap-1.5 px-2 py-1 text-xs",
        className,
      )}
      title={title}
      aria-label={t("chat.whatsappAccountAria", { title })}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        {isConnected && !compact && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
              color.dot,
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            isConnected ? color.dot : "bg-fg-subtle",
          )}
        />
      </span>
      <span className="truncate font-semibold">{label}</span>
      {!compact && phone && phone !== label && (
        <span dir="ltr" className="hidden truncate opacity-70 xl:inline">
          {phone}
        </span>
      )}
    </span>
  );
}

/**
 * The account a message will leave on, for any channel.
 *
 * The WhatsApp route above reads a linked device; a customer reachable on
 * Telegram needs the same answer from its bot account, and a merged customer
 * needs it most of all - the account changes as the thread does, and a
 * composer that does not say which one is about to send is how a reply leaves
 * on the wrong network.
 */
export function ChannelRoute({
  label,
  address,
  className,
}: {
  label: string;
  address?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-muted",
        className,
      )}
    >
      <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">via</span>
      <span className="truncate font-semibold text-fg">{label}</span>
      {address && address !== label && (
        <span className="truncate font-mono text-[11px]">{address}</span>
      )}
    </span>
  );
}

interface ConnectionRouteProps {
  connection: WhatsAppConnectionIdentity;
  mode: "receiving" | "sending";
  className?: string;
  /**
   * Holds the raw number back until `sm`. The conversation header sets this:
   * on a phone the account name, a 12-digit number and the online status all
   * competed for one ~200px line and every one of them ended up ellipsised.
   */
  compact?: boolean;
}

/** Explicit human-readable routing context for the header and composer. */
export function ConnectionRoute({
  connection,
  mode,
  className,
  compact = false,
}: ConnectionRouteProps) {
  const label = getConnectionLabel(connection);
  const phone = getConnectionPhone(connection);
  const Icon = mode === "sending" ? Radio : Smartphone;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-muted",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">{mode === "sending" ? "via" : "to"}</span>
      <span className="truncate font-semibold text-fg">{label}</span>
      {phone && phone !== label && (
        <span
          className={cn(
            "truncate font-mono text-[11px]",
            compact && "hidden sm:inline",
          )}
        >
          {phone}
        </span>
      )}
    </span>
  );
}
