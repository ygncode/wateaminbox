import type { ReactNode } from 'react'
import { type Permission, usePermissions } from '../../hooks/usePermissions'

interface PermissionGuardProps {
  children: ReactNode
  /**
   * Permission required to render children
   */
  permission?: Permission
  /**
   * If provided, user must have ALL these permissions
   */
  allOf?: Permission[]
  /**
   * If provided, user must have ANY of these permissions
   */
  anyOf?: Permission[]
  /**
   * Require owner role
   */
  requireOwner?: boolean
  /**
   * Require admin role (includes owner)
   */
  requireAdmin?: boolean
  /**
   * Content to show when permission is denied
   */
  fallback?: ReactNode
}

/**
 * Component to conditionally render children based on permissions
 *
 * @example
 * ```tsx
 * // Single permission
 * <PermissionGuard permission="can_export">
 *   <ExportButton />
 * </PermissionGuard>
 *
 * // Any of multiple permissions
 * <PermissionGuard anyOf={["can_invite", "can_manage_team"]}>
 *   <TeamSettingsLink />
 * </PermissionGuard>
 *
 * // All of multiple permissions
 * <PermissionGuard allOf={["can_export", "can_delete"]}>
 *   <BulkActionsMenu />
 * </PermissionGuard>
 *
 * // With fallback
 * <PermissionGuard permission="can_send_messages" fallback={<DisabledInput />}>
 *   <MessageComposer />
 * </PermissionGuard>
 * ```
 */
export function PermissionGuard({
  children,
  permission,
  allOf,
  anyOf,
  requireOwner,
  requireAdmin,
  fallback = null,
}: PermissionGuardProps) {
  const { hasPermission, hasAllPermissions, hasAnyPermission, isOwner, isAdmin } = usePermissions()

  // Check owner requirement
  if (requireOwner && !isOwner) {
    return <>{fallback}</>
  }

  // Check admin requirement
  if (requireAdmin && !isAdmin) {
    return <>{fallback}</>
  }

  // Check single permission
  if (permission && !hasPermission(permission)) {
    return <>{fallback}</>
  }

  // Check all permissions
  if (allOf && !hasAllPermissions(allOf)) {
    return <>{fallback}</>
  }

  // Check any permission
  if (anyOf && !hasAnyPermission(anyOf)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

/**
 * Higher-order component version of PermissionGuard
 */
export function withPermission<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  permission: Permission,
  FallbackComponent?: React.ComponentType<P>
) {
  return function WithPermissionComponent(props: P) {
    const { hasPermission } = usePermissions()

    if (!hasPermission(permission)) {
      return FallbackComponent ? <FallbackComponent {...props} /> : null
    }

    return <WrappedComponent {...props} />
  }
}
