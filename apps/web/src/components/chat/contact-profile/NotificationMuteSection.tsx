import { normalizeJid } from "@wateaminbox/shared";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RightPanelSection } from "@/components/layout/right-panel";
import { useNotifications } from "@/hooks/notification";
import type { ContactData } from "./types";

export function NotificationMuteSection({ contact }: { contact: ContactData }) {
  const { isContactMuted, muteContact, unmuteContact, isSyncing } =
    useNotifications();
  const jid = normalizeJid(contact.jid);
  if (!jid) return null;
  const muted = isContactMuted(jid);

  return (
    <RightPanelSection title="Notifications">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {muted ? (
            <BellOff className="size-5 shrink-0 text-gray-400" />
          ) : (
            <Bell className="size-5 shrink-0 text-gray-500" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
              {muted ? "Notifications muted" : "Message notifications"}
            </p>
            <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
              Muting affects desktop and push alerts only.
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
