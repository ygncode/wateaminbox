import {
  Crown,
  MoreVertical,
  Shield,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
} from '@/components/ui'
import type { MemberCardProps } from './types'

/**
 * Individual member card with role management
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
  const initials = member.email.slice(0, 2).toUpperCase()

  const RoleIcon =
    member.role === 'owner'
      ? Crown
      : member.role === 'admin'
        ? ShieldCheck
        : Shield
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1)

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
            <RoleIcon className="h-3 w-3" />
            <span>{roleLabel}</span>
          </div>
        </div>
      </div>

      {canManage && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuToggle}
            className="h-8 w-8"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>

          {isMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated py-1 shadow-lg">
              {member.role === 'member' ? (
                <button
                  onClick={() => onRoleChange('admin')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Make Admin
                </button>
              ) : (
                <button
                  onClick={() => onRoleChange('member')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                >
                  <Shield className="h-4 w-4" />
                  Make Member
                </button>
              )}
              <button
                onClick={onRemove}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
