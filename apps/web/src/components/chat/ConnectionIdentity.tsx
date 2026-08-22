import type { WhatsAppConnectionIdentity } from "@wateaminbox/shared";
import { Radio, Smartphone } from "lucide-react";
import { cn, formatPhoneLikeText } from "@/lib/utils";

const accountColors = [
  {
    dot: "bg-emerald-500",
    tint: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  },
  {
    dot: "bg-sky-500",
    tint: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800",
  },
  {
    dot: "bg-amber-500",
    tint: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
  },
  {
    dot: "bg-rose-500",
    tint: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800",
  },
  {
    dot: "bg-violet-500",
    tint: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800",
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
    connection.name || connection.phoneNumber || "WhatsApp account",
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
  const color = getConnectionColor(connection.id);
  const label = getConnectionLabel(connection);
  const phone = getConnectionPhone(connection);
  const isConnected = connection.status === "connected";
  const title = `${label}${phone && phone !== label ? ` · ${phone}` : ""} · ${isConnected ? "Connected" : "Disconnected"}`;

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
      aria-label={`WhatsApp account: ${title}`}
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
            isConnected ? color.dot : "bg-gray-400 dark:bg-dark-text-tertiary",
          )}
        />
      </span>
      <span className="truncate font-semibold">{label}</span>
      {!compact && phone && phone !== label && (
        <span className="hidden truncate opacity-70 xl:inline">{phone}</span>
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
        "inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-dark-text-secondary",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">{mode === "sending" ? "via" : "to"}</span>
      <span className="truncate font-semibold text-gray-700 dark:text-dark-text-primary">
        {label}
      </span>
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
