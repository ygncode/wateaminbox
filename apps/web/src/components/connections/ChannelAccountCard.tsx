import { Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChannelAccount } from "@/lib/api/channel-accounts";
import { cn } from "@/lib/utils";
import { catalogEntryForAccount } from "./channel-catalog";

interface ChannelAccountCardProps {
  account: ChannelAccount;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}

/** Status vocabulary is the provider's; only the wording is ours. */
const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting",
  connected: "Connected",
  degraded: "Degraded",
  disconnected: "Disconnected",
  disabled: "Disabled",
  error: "Error",
  archived: "Archived",
};

export function ChannelAccountCard({
  account,
  onDisconnect,
  isDisconnecting,
}: ChannelAccountCardProps) {
  const entry = catalogEntryForAccount(account.channel, account.provider);
  const isLive = account.status === "connected";
  const name = account.displayName?.trim() || entry?.name || account.channel;

  // Only Telegram reports this today, and only a connected account is worth
  // warning about: a disconnected one has a louder problem already.
  const groupMessagesRestricted =
    account.provider === "telegram_bot" &&
    account.canReadAllGroupMessages === false &&
    isLive;

  return (
    <div className="rounded-xl border border-[#dce3de] bg-white dark:border-white/[0.08] dark:bg-white/[0.025]">
      <div className="flex items-center gap-3 p-3.5">
        <div className="relative shrink-0">
          <span
            className={cn(
              "grid h-11 w-11 place-items-center rounded-xl shadow-sm",
              entry?.tileClassName ?? "bg-slate-500 text-white",
            )}
          >
            {entry ? (
              <entry.Mark className="h-6 w-6" />
            ) : (
              <span className="text-sm font-semibold uppercase">
                {account.channel.slice(0, 2)}
              </span>
            )}
          </span>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-[#172622]",
              isLive ? "bg-emerald-500" : "bg-slate-400",
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#10211b] dark:text-[#eef8f3]">
            {name}
          </p>
          <p className="truncate text-xs text-[#65736d] dark:text-[#a9bab4]">
            {entry?.name ?? account.channel}
            {" · "}
            {STATUS_LABEL[account.status] ?? account.status}
            {account.externalAccountId ? ` · ${account.externalAccountId}` : ""}
          </p>
          {/* A provider status is the only clue when a webhook half-registered. */}
          {account.providerStatus && !isLive && (
            <p className="truncate text-xs text-amber-700 dark:text-amber-400">
              {account.providerStatus.split("_").join(" ")}
            </p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onDisconnect}
          disabled={isDisconnecting}
          className="shrink-0 gap-1.5"
        >
          {isDisconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          Disconnect
        </Button>
      </div>

      {groupMessagesRestricted && (
        <p className="border-t border-amber-200/70 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-400/15 dark:bg-amber-400/[0.06] dark:text-amber-200">
          Group messages are limited: this bot has Telegram&apos;s privacy mode
          on, so it only receives commands and replies in groups. Send{" "}
          <code className="font-mono">/setprivacy</code> to @BotFather, choose
          this bot, select Disable, then remove and re-add it to each group.
          Direct chats are unaffected.
        </p>
      )}
    </div>
  );
}
