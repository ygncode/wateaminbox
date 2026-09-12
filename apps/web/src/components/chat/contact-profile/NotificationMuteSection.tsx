import { normalizeJid } from "@wateaminbox/shared";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RightPanelSection } from "@/components/layout/right-panel";
import { useCustomerChats } from "@/hooks/contact/useCustomerChats";
import { useNotifications } from "@/hooks/notification";
import type { ContactData } from "./types";
import { useTranslation } from "react-i18next";

export function NotificationMuteSection({ contact }: { contact: ContactData }) {
  const { t } = useTranslation();

  const { isContactMuted, muteContact, unmuteContact, isSyncing } =
    useNotifications();
  // Muting is about the person, so it covers every thread they can be reached
  // on. One token is not enough for a merged customer: alerts are matched
  // against the sender's address, and the surviving contact's own token is its
  // id when that customer arrived on a channel with no JID - an address no
  // incoming message ever carries, so muting them did nothing at all.
  const { data: threads = [] } = useCustomerChats(contact.id);
  const threadTokens = threads.map((thread) =>
    thread.jid ? normalizeJid(thread.jid) : thread.chatId,
  );
  const jid = contact.jid ? normalizeJid(contact.jid) : null;
  const ownToken = jid ?? contact.conversationId ?? contact.id;
  const tokens = [...new Set([...threadTokens, ownToken])].filter(
    (token): token is string => Boolean(token),
  );
  if (tokens.length === 0) return null;
  // Muted only when every thread is: a customer still ringing on one channel
  // is not muted, and saying otherwise would hide alerts the operator expects.
  const muted = tokens.every((token) => isContactMuted(token));

  return (
    <RightPanelSection title={t("contacts.notifications", "Notifications")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {muted ? (
            <BellOff className="size-5 shrink-0 text-gray-400" />
          ) : (
            <Bell className="size-5 shrink-0 text-gray-500" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
              {muted
                ? t("contacts.notificationsMuted", "Notifications muted")
                : t("contacts.messageNotifications", "Message notifications")}
            </p>
            <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
              {t(
                "contacts.muteHint",
                "Muting affects desktop and push alerts only.",
              )}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isSyncing}
          onClick={() =>
            tokens.forEach((token) =>
              muted ? unmuteContact(token) : muteContact(token),
            )
          }
        >
          {muted ? "Unmute" : "Mute"}
        </Button>
      </div>
    </RightPanelSection>
  );
}
