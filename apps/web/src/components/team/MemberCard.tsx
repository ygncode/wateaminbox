import { Crown, Shield, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Avatar, AvatarFallback, Badge, EllipsisMenu } from "@/components/ui";
import type { EllipsisMenuItem } from "@/components/ui/ellipsis-menu";
import type { MemberCardProps } from "./types";

/**
 * Individual member card with role management
 * Uses EllipsisMenu for accessible dropdown with keyboard navigation
 */
export function MemberCard({
  member,
  isCurrentUser,
  canManage,
  isMenuOpen,
  onMenuToggle,
  onRoleChange,
  onRemove,
}: MemberCardProps) {
  const initials = member.email.slice(0, 2).toUpperCase();

  const RoleIcon =
    member.role === "owner"
      ? Crown
      : member.role === "admin"
        ? ShieldCheck
        : Shield;
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);

  // Build menu items dynamically based on member role
  const menuItems = useMemo<EllipsisMenuItem[]>(() => {
    const items: EllipsisMenuItem[] = [];

    if (member.role === "member") {
      items.push({
        id: "make-admin",
        label: "Make Admin",
        icon: ShieldCheck,
        onClick: () => onRoleChange("admin"),
      });
    } else if (member.role === "admin") {
      items.push({
        id: "make-member",
        label: "Make Member",
        icon: Shield,
        onClick: () => onRoleChange("member"),
      });
    }

    items.push({
      id: "remove",
      label: "Remove",
      icon: Trash2,
      onClick: onRemove,
      destructive: true,
    });

    return items;
  }, [member.role, onRoleChange, onRemove]);

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4 hover:bg-gray-50 dark:hover:bg-dark-tertiary">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-whatsapp-light-green text-whatsapp-dark-green">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 dark:text-dark-text-primary">
              {member.email}
            </p>
            {isCurrentUser && (
              <Badge variant="secondary" className="text-xs">
                You
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-dark-text-secondary">
            <RoleIcon className="h-3 w-3" aria-hidden="true" />
            <span>{roleLabel}</span>
          </div>
        </div>
      </div>

      {canManage && (
        <EllipsisMenu
          items={menuItems}
          ariaLabel="Member actions"
          open={isMenuOpen}
          onOpenChange={(open) => {
            if (open !== isMenuOpen) {
              onMenuToggle();
            }
          }}
        />
      )}
    </div>
  );
}
