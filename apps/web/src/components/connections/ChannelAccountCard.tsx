import {
  Edit2,
  Loader2,
  MoreVertical,
  Power,
  PowerOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { ChannelAccount } from "@/lib/api/channel-accounts";
import { cn } from "@/lib/utils";
import { catalogEntryForAccount } from "./channel-catalog";

interface ChannelAccountCardProps {
  account: ChannelAccount;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  /** Erase an already-disconnected account and the history it brought in. */
  onPurge: () => void;
  isPurging: boolean;
  onRename: (displayName: string) => void;
  isRenaming: boolean;
  onPause: () => void;
  onResume: () => void;
  isPausing: boolean;
  isResuming: boolean;
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
  onPurge,
  isPurging,
  onRename,
  isRenaming,
  onPause,
  onResume,
  isPausing,
  isResuming,
}: ChannelAccountCardProps) {
  const { t } = useTranslation();
  const entry = catalogEntryForAccount(account.channel, account.provider);
  const isLive = account.status === "connected";
  // Paused by an operator, as opposed to knocked offline by the provider: the
  // difference decides whether the menu offers Resume or Disconnect.
  const isPaused = account.status === "disabled";
  const isBusy = isPausing || isResuming;
  const name = account.displayName?.trim() || entry?.name || account.channel;
  const [showMenu, setShowMenu] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  // A disconnected account keeps its conversations, so it stays listed as the
  // only handle on them. Everything it can still do is different from a live
  // account: it cannot send, pause, or resume - only be erased.
  const isArchived = Boolean(account.archivedAt);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);

  const commitRename = () => {
    const next = editName.trim();
    // An empty name is a slip, not an instruction to clear the label; and a
    // no-op rename should not spend a request.
    if (!next || next === name) {
      setEditing(false);
      setEditName(name);
      return;
    }
    onRename(next);
    setEditing(false);
  };

  // Only Telegram reports this today, and only a connected account is worth
  // warning about: a disconnected one has a louder problem already.
  const groupMessagesRestricted =
    account.provider === "telegram_bot" &&
    account.canReadAllGroupMessages === false &&
    isLive;

  return (
    <div className="overflow-visible rounded-xl border border-[#dce3de] bg-white dark:border-white/[0.08] dark:bg-white/[0.025]">
      <div className="flex items-center gap-3 overflow-visible p-3.5">
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
          {editing ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={editName}
                autoFocus
                maxLength={100}
                onChange={(event) => setEditName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") {
                    setEditing(false);
                    setEditName(name);
                  }
                }}
                aria-label={t("connections.renameAccount", "Account name")}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-100 px-2 py-1 text-sm text-gray-900 transition-all placeholder-gray-500 focus:border-whatsapp-green focus:bg-white focus:outline-none focus:ring-1 focus:ring-whatsapp-green dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder-dark-text-tertiary dark:focus:bg-dark-elevated"
              />
              <Button size="sm" onClick={commitRename} disabled={isRenaming}>
                {isRenaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("common.save", "Save")
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setEditName(name);
                }}
              >
                {t("common.cancel", "Cancel")}
              </Button>
            </div>
          ) : (
            <p className="truncate text-sm font-semibold text-[#10211b] dark:text-[#eef8f3]">
              {name}
            </p>
          )}
          <p className="truncate text-xs text-[#65736d] dark:text-[#a9bab4]">
            {entry?.name ?? account.channel}
            {" · "}
            {STATUS_LABEL[account.status] ?? account.status}
            {/* The handle first: an operator recognises @a_bot, not 5326706984,
                and it is what their customers see. */}
            {account.username
              ? ` · @${account.username}`
              : account.externalAccountId
                ? ` · ${account.externalAccountId}`
                : ""}
          </p>
          {/* A provider status is the only clue when a webhook half-registered. */}
          {account.providerStatus && !isLive && (
            <p className="truncate text-xs text-amber-700 dark:text-amber-400">
              {account.providerStatus.split("_").join(" ")}
            </p>
          )}
        </div>

        {/*
          A channel account carries the same weight as a linked WhatsApp
          number, so it gets the same affordance: a More menu, not a live
          button. Unlinking revokes the bot's webhook and erases its stored
          token - a click's distance from the resting state was too short for
          something that cannot be undone without the token again.
        */}
        <div className="relative shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMenu(!showMenu)}
            disabled={isDisconnecting || isBusy}
            className="h-8 w-8 p-0"
            aria-label={t("connections.moreActionsFor", {
              defaultValue: "More actions for {{name}}",
              name,
            })}
            title={t("connections.moreActions", "More actions")}
          >
            {isDisconnecting || isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </Button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 z-20 mt-2 w-48 animate-fade-in rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl shadow-gray-200/50 dark:border-dark-border dark:bg-dark-elevated dark:shadow-black/30">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
                  onClick={() => {
                    setEditName(name);
                    setEditing(true);
                    setShowMenu(false);
                  }}
                >
                  <Edit2 className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
                  {t("connections.rename", "Rename")}
                </button>
                {isPaused ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-whatsapp-teal-green transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-900/30"
                    onClick={() => {
                      onResume();
                      setShowMenu(false);
                    }}
                  >
                    {isResuming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Power className="h-4 w-4" />
                    )}
                    {t("connections.resume", "Resume")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
                    onClick={() => {
                      onPause();
                      setShowMenu(false);
                    }}
                  >
                    {isPausing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PowerOff className="h-4 w-4" />
                    )}
                    {t("connections.disconnect", "Disconnect")}
                  </button>
                )}
                <div className="my-1.5 border-t border-gray-100 dark:border-dark-border" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                  onClick={() => {
                    if (isArchived) setPurgeOpen(true);
                    else setUnlinkOpen(true);
                    setShowMenu(false);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {isArchived
                    ? t("connections.deletePermanently", "Delete permanently")
                    : t("connections.archiveUnlink", "Archive & unlink")}
                </button>
              </div>
            </>
          )}
        </div>
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

      <ConfirmationDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={t("connections.deletePermanentlyConfirm", {
          defaultValue: "Permanently delete {{name}}?",
          name,
        })}
        description={t("connections.channelPurgeDescription", {
          defaultValue:
            "This erases the conversations, messages, and customers this account brought in. Disconnecting kept them; this does not. It cannot be undone.",
        })}
        confirmText={t("connections.deletePermanentlyAction", "Delete data")}
        onConfirm={() => {
          onPurge();
          setPurgeOpen(false);
        }}
        isLoading={isPurging}
        isDestructive
      />

      <ConfirmationDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title={t("connections.archiveUnlinkConfirm", {
          defaultValue: "Archive and unlink {{name}}?",
          name,
        })}
        description={t("connections.channelArchiveUnlinkDescription", {
          defaultValue:
            "This removes the webhook from {{channel}} and erases the stored credential, so reconnecting needs the bot token again. Conversations, assignments, and notes are retained.",
          channel: entry?.name ?? account.channel,
        })}
        confirmText={t("connections.archiveUnlink", "Archive & unlink")}
        onConfirm={() => {
          onDisconnect();
          setUnlinkOpen(false);
        }}
        isDestructive
      />
    </div>
  );
}
