import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ContactData } from "./types";

interface ProfileHeaderProps {
  contact: ContactData;
}

/**
 * Profile header with avatar and display name
 */
export function ProfileHeader({ contact }: ProfileHeaderProps) {
  const initials = contact.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50 dark:bg-dark-elevated py-8">
      <Avatar className="h-32 w-32 border-4 border-white dark:border-dark-tertiary shadow-lg">
        <AvatarImage
          src={contact.profilePictureUrl || undefined}
          alt={contact.displayName}
        />
        <AvatarFallback className="bg-whatsapp-teal-green text-3xl text-white">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          {contact.displayName}
        </h3>
        {contact.customName && contact.pushName && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            ~{contact.pushName}
          </p>
        )}
      </div>
    </div>
  );
}
