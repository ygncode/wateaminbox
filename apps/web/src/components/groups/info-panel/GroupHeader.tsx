import { Shield, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui";
import type { GroupHeaderProps } from "./types";

/**
 * Group header with avatar and display name
 */
export function GroupHeader({ group, isAdmin }: GroupHeaderProps) {
  const initials = group.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50 dark:bg-dark-secondary py-8">
      <Avatar className="h-32 w-32 border-4 border-white dark:border-dark-border shadow-lg">
        <AvatarImage
          src={group.profilePictureUrl || undefined}
          alt={group.displayName}
        />
        <AvatarFallback className="bg-gray-400 dark:bg-dark-tertiary text-3xl text-white dark:text-dark-text-primary">
          {group.profilePictureUrl ? initials : <Users className="h-12 w-12" />}
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          {group.displayName}
        </h3>
        {group.customName && group.name && group.customName !== group.name && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            ~{group.name}
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
          <Users className="inline h-4 w-4 mr-1" />
          {group.participantCount} participants
        </p>
        {isAdmin && (
          <Badge
            variant="secondary"
            className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-1 mt-2"
          >
            <Shield className="h-3 w-3" />
            You are Admin
          </Badge>
        )}
      </div>
    </div>
  );
}
