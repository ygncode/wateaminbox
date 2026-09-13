import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import type { ContactData } from "./types";

interface ProfileHeaderProps {
  contact: ContactData;
  onMessage?: () => void;
  /**
   * How many threads this customer is reachable on. More than one is the
   * whole story of a merged customer, so the header says it rather than
   * leaving it to be inferred from a section further down.
   */
  chatCount?: number;
}

/**
 * Profile header with avatar and display name
 */
export function ProfileHeader({
  contact,
  onMessage,
  chatCount,
}: ProfileHeaderProps) {
  const { t } = useTranslation();
  const username = contact.username ? `@${contact.username}` : null;
  const secondaryIdentity =
    username && contact.displayName !== username
      ? username
      : contact.customName && contact.pushName
        ? `~${contact.pushName}`
        : null;

  return (
    <div className="flex flex-col items-center gap-2 bg-gray-50 dark:bg-dark-elevated py-5">
      <Avatar className="h-20 w-20 border-2 border-white dark:border-dark-tertiary shadow-sm">
        <AvatarImage
          src={contact.profilePictureUrl || undefined}
          alt={contact.displayName}
        />
        <AvatarFallback className="p-0">
          <IdentityAvatarFallback
            displayName={contact.displayName}
            identity={contact.jid || contact.phoneNumber || contact.id}
            kind={contact.isGroup ? "group" : "user"}
            className="text-xl"
            iconClassName="h-1/2 w-1/2"
          />
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
          {contact.displayName}
        </h3>
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
          {[
            secondaryIdentity,
            chatCount && chatCount > 1
              ? t("contacts.mergedChatCount", {
                  count: chatCount,
                  defaultValue: "Merged chat · {{count}} chats",
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {onMessage && !contact.isGroup && (
        <Button
          type="button"
          onClick={onMessage}
          size="sm"
          className="mt-1 min-w-28 rounded-full bg-[#00a884] px-5 text-white hover:bg-[#008f72]"
        >
          <MessageCircle aria-hidden="true" />
          {t("chat.messageContact", "Message")}
        </Button>
      )}
    </div>
  );
}
