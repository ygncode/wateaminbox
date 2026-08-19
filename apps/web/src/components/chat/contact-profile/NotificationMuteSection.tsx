import { normalizeJid } from "@wateaminbox/shared";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RightPanelSection } from "@/components/layout/right-panel";
import { useNotifications } from "@/hooks/notification";
import type { ContactData } from "./types";
import { useTranslation } from "react-i18next";

export function NotificationMuteSection({ contact }: { contact: ContactData }) {
  const { t } = useTranslation();

  const { isContactMuted, muteContact, unmuteContact, isSyncing } =
    useNotifications();
  const jid = normalizeJid(contact.jid);
  if (!jid) return null;
  const muted = isContactMuted(jid);

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
          onClick={() => (muted ? unmuteContact(jid) : muteContact(jid))}
        >
          {muted ? "Unmute" : "Mute"}
        </Button>
      </div>
    </RightPanelSection>
  );
}
