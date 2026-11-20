import { useState } from "react";
import { Ban, BellOff, CheckCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  useContactSuppression,
  useSetContactSuppression,
} from "@/hooks/contact/useContactSuppression";
import { toast } from "sonner";
import { resolveSuppressionView } from "./suppression-state";
import type { ContactData } from "./types";

interface BlockStatusSectionProps {
  contact: ContactData;
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  messenger: "Messenger",
  instagram: "Instagram",
  line: "LINE",
  viber: "Viber",
  email: "Email",
};

/**
 * Block and mute a customer on every channel they use.
 *
 * A block is the workspace's decision about the person, not one app's
 * blocklist: most channels (a Telegram bot, LINE, email) cannot block anyone,
 * so WATeamInbox drops their messages itself. Where a channel can also block
 * or reports that the person blocked us, that is shown per channel.
 * Hidden for groups: a block names a person.
 */
export function BlockStatusSection({ contact }: BlockStatusSectionProps) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const status = useContactSuppression(contact.isGroup ? null : contact.id);
  const update = useSetContactSuppression(contact.id);

  if (contact.isGroup) return null;

  const view = resolveSuppressionView(status.data, contact.isBlocked);
  const blocked = view.kind === "blocked";
  const muted = view.kind === "muted" ? view : null;
  const busy = update.isPending || status.isLoading;

  const run = (input: Parameters<typeof update.mutate>[0]) =>
    update.mutate(input, {
      onError: () =>
        toast.error(
          t(
            "contacts.suppression.failed",
            "Could not update the block. Try again.",
          ),
        ),
    });

  const mutedUntil = muted?.expiresAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(muted.expiresAt))
    : null;

  return (
    <>
      <RightPanelSection
        title={t("contacts.suppression.title", "Block and mute")}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {blocked ? (
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              ) : muted ? (
                <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
              ) : (
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              )}
              <div>
                <p
                  className={
                    blocked
                      ? "text-sm font-medium text-danger"
                      : "text-sm text-fg"
                  }
                >
                  {blocked
                    ? t(
                        "contacts.suppression.blocked",
                        "Blocked on every channel",
                      )
                    : muted
                      ? mutedUntil
                        ? t("contacts.suppression.mutedUntil", {
                            defaultValue: "Muted until {{time}}",
                            time: mutedUntil,
                          })
                        : t("contacts.suppression.muted", "Muted")
                      : t("contacts.suppression.active", "Not blocked")}
                </p>
                <p className="text-xs text-fg-muted">
                  {blocked
                    ? t(
                        "contacts.suppression.blockedHint",
                        "New messages from this customer are dropped and nobody can message them.",
                      )
                    : muted
                      ? t(
                          "contacts.suppression.mutedHint",
                          "Messages still arrive, without notifications or unread badges.",
                        )
                      : t(
                          "contacts.suppression.activeHint",
                          "Messages from this customer arrive normally.",
                        )}
                </p>
              </div>
            </div>
            {blocked ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run({ scope: "block", on: false })}
                className="shrink-0 border-accent/40 text-accent hover:bg-accent-soft hover:text-accent-hover"
              >
                <CheckCircle className="me-1 h-4 w-4" />
                {t("contacts.suppression.unblock", "Unblock")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="shrink-0 border-danger/40 text-danger hover:bg-danger-soft hover:text-danger"
              >
                <Ban className="me-1 h-4 w-4" />
                {t("contacts.suppression.block", "Block")}
              </Button>
            )}
          </div>

          {!blocked && (
            <div className="flex flex-wrap gap-2">
              {muted ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run({ scope: "mute_inbound", on: false })}
                >
                  {t("contacts.suppression.unmute", "Unmute")}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run({
                        scope: "mute_inbound",
                        on: true,
                        durationMinutes: 60,
                      })
                    }
                  >
                    <BellOff className="me-1 h-4 w-4" />
                    {t("contacts.suppression.mute1h", "Mute for 1 hour")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run({
                        scope: "mute_inbound",
                        on: true,
                        durationMinutes: 60 * 24,
                      })
                    }
                  >
                    {t("contacts.suppression.mute24h", "Mute for 24 hours")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run({ scope: "mute_inbound", on: true })}
                  >
                    {t(
                      "contacts.suppression.muteForever",
                      "Mute until I unmute",
                    )}
                  </Button>
                </>
              )}
            </div>
          )}

          {status.data?.channels.length ? (
            <ul className="space-y-1" data-testid="suppression-channels">
              {status.data.channels.map((channel) => {
                const label =
                  CHANNEL_LABELS[channel.channel] ?? channel.channel;
                return (
                  <li key={channel.channel} className="text-xs text-fg-muted">
                    <span className="font-medium text-fg">{label}</span>
                    {channel.providerBlocked &&
                      ` · ${t("contacts.suppression.providerBlocked", {
                        defaultValue: "Also blocked by {{channel}}",
                        channel: label,
                      })}`}
                    {channel.unreachable &&
                      ` · ${t("contacts.suppression.unreachable", {
                        defaultValue:
                          "This customer has blocked or left you on {{channel}}",
                        channel: label,
                      })}`}
                    {channel.dropped > 0 &&
                      ` · ${t("contacts.suppression.dropped", {
                        defaultValue: "{{count}} messages dropped",
                        count: channel.dropped,
                      })}`}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {view.kind !== "active" && view.showNotEnforced ? (
            <p className="flex items-start gap-1.5 text-xs text-fg-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(
                "contacts.suppression.notEnforced",
                "Blocking is not switched on for this workspace yet. The choice is saved and takes effect once it is.",
              )}
            </p>
          ) : null}
        </div>
      </RightPanelSection>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("contacts.suppression.confirmTitle", {
          defaultValue: "Block {{name}}?",
          name: contact.displayName,
        })}
        description={t(
          "contacts.suppression.confirmBody",
          "Their new messages on every channel are dropped and nobody in this workspace can message them. You can unblock them at any time.",
        )}
        confirmText={t("contacts.suppression.block", "Block")}
        cancelText={t("common.cancel", "Cancel")}
        isDestructive
        isLoading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { scope: "block", on: true },
            {
              onSuccess: () => setConfirming(false),
              onError: () =>
                toast.error(
                  t(
                    "contacts.suppression.failed",
                    "Could not update the block. Try again.",
                  ),
                ),
            },
          )
        }
      />
    </>
  );
}
