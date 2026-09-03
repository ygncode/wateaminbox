import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import type { ContactData } from "./types";

interface ProfileHeaderProps {
  contact: ContactData;
  onMessage?: () => void;
}

/**
 * Profile header with avatar and display name
 */
export function ProfileHeader({ contact, onMessage }: ProfileHeaderProps) {
  const { t } = useTranslation();
  const username = contact.username ? `@${contact.username}` : null;
  const secondaryIdentity =
    username && contact.displayName !== username
      ? username
      : contact.customName && contact.pushName
        ? `~${contact.pushName}`
        : null;

  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50 dark:bg-dark-elevated py-8">
      <Avatar className="h-32 w-32 border-4 border-white dark:border-dark-tertiary shadow-lg">
        <AvatarImage
          src={contact.profilePictureUrl || undefined}
          alt={contact.displayName}
        />
        <AvatarFallback className="p-0">
          <IdentityAvatarFallback
            displayName={contact.displayName}
            identity={contact.jid || contact.phoneNumber || contact.id}
            kind={contact.isGroup ? "group" : "user"}
            className="text-3xl"
            iconClassName="h-1/2 w-1/2"
          />
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          {contact.displayName}
        </h3>
        {secondaryIdentity && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            {secondaryIdentity}
          </p>
        )}
      </div>
      {onMessage && !contact.isGroup && (
        <Button
          type="button"
          onClick={onMessage}
          className="min-w-32 rounded-full bg-[#00a884] px-6 text-white hover:bg-[#008f72]"
        >
          <MessageCircle aria-hidden="true" />
          {t("chat.messageContact", "Message")}
        </Button>
      )}
    </div>
  );
}
