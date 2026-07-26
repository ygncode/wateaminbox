import { Crown, Settings2, Shield, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Avatar, AvatarFallback, Badge, EllipsisMenu } from "@/components/ui";
import type { EllipsisMenuItem } from "@/components/ui/ellipsis-menu";
import type { MemberCardProps } from "./types";

export function MemberCard({
  member,
  isCurrentUser,
  canChangeRole,
  canEditPermissions,
  canRemove,
  isMenuOpen,
  onMenuToggle,
  onRoleChange,
  onEditPermissions,
  onRemove,
}: MemberCardProps) {
  const displayName = member.name || member.email;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const RoleIcon =
    member.role === "owner"
      ? Crown
      : member.role === "admin"
        ? ShieldCheck
        : Shield;
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);
  const hasCustomAccess = Boolean(
    member.permissions && Object.keys(member.permissions).length,
  );

  const menuItems = useMemo<EllipsisMenuItem[]>(() => {
    const items: EllipsisMenuItem[] = [];
    if (canChangeRole && member.role === "member")
      items.push({
        id: "make-admin",
        label: "Make admin",
        icon: ShieldCheck,
        onClick: () => onRoleChange("admin"),
      });
    if (canChangeRole && member.role === "admin")
      items.push({
        id: "make-member",
        label: "Make member",
        icon: Shield,
        onClick: () => onRoleChange("member"),
      });
    if (canEditPermissions)
      items.push({
        id: "permissions",
        label: "Edit access",
        icon: Settings2,
        onClick: onEditPermissions,
      });
    if (canRemove)
      items.push({
        id: "remove",
        label: "Remove member",
        icon: Trash2,
        onClick: onRemove,
        destructive: true,
      });
    return items;
  }, [
    canChangeRole,
    canEditPermissions,
    canRemove,
    member.role,
    onEditPermissions,
    onRemove,
    onRoleChange,
  ]);

  return (
    <div className="relative grid gap-3 p-4 transition-colors hover:bg-[#f8faf8] dark:hover:bg-dark-tertiary/50 md:grid-cols-[minmax(0,1.4fr)_8rem_9rem_8rem_3rem] md:items-center md:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-[#dcefe7] font-semibold text-[#075c41]">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            {isCurrentUser && (
              <Badge variant="secondary" className="text-[10px]">
                You
              </Badge>
            )}
          </div>
          {member.name && (
            <p className="truncate text-xs text-[#65736d] dark:text-dark-text-secondary">
              {member.email}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <RoleIcon className="h-3.5 w-3.5 text-[#65736d]" />
        <span>{roleLabel}</span>
      </div>
      <div>
        <Badge
          variant={hasCustomAccess ? "default" : "secondary"}
          className="text-[10px]"
        >
          {hasCustomAccess ? "Custom access" : "Role defaults"}
        </Badge>
      </div>
      <time className="font-mono text-xs text-[#65736d] dark:text-dark-text-secondary">
        {new Date(member.joinedAt).toLocaleDateString()}
      </time>
      <div className="absolute right-4 mt-1 md:static md:mt-0">
        {menuItems.length > 0 && (
          <EllipsisMenu
            items={menuItems}
            ariaLabel={`Actions for ${displayName}`}
            open={isMenuOpen}
            onOpenChange={(open) => {
              if (open !== isMenuOpen) onMenuToggle();
            }}
          />
        )}
      </div>
    </div>
  );
}
