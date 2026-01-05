import {
  Clock,
  Crown,
  Mail,
  MoreVertical,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Avatar, AvatarFallback, Badge, Button, Input, Skeleton } from '@/components/ui'
import {
  type CompanyMember,
  type Invitation,
  useCancelInvitation,
  useCompanyMembers,
  useInviteMember,
  usePendingInvitations,
  useRemoveMember,
  useResendInvitation,
  useUpdateMemberRole,
} from '@/hooks/useTeam'
import { cn } from '@/lib/utils'

export interface TeamManagementProps {
  companyId: string
  currentUserId: string
  currentUserRole: 'owner' | 'admin' | 'member'
}

/**
 * Team Management component for managing members and invitations
 */
export function TeamManagement({ companyId, currentUserId, currentUserRole }: TeamManagementProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members')
  const [showInviteForm, setShowInviteForm] = useState(false)

  const isAdmin = currentUserRole === 'owner' || currentUserRole === 'admin'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-dark-border px-6 py-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">Team</h2>
        {isAdmin && (
          <Button
            onClick={() => setShowInviteForm(true)}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-dark-border">
        <button
          onClick={() => setActiveTab('members')}
          className={cn(
            'flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors',
            activeTab === 'members'
              ? 'border-b-2 border-whatsapp-teal-green text-whatsapp-teal-green'
              : 'text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary'
          )}
        >
          <Users className="h-4 w-4" />
          Members
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('invitations')}
            className={cn(
              'flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors',
              activeTab === 'invitations'
                ? 'border-b-2 border-whatsapp-teal-green text-whatsapp-teal-green'
                : 'text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary'
            )}
          >
            <Mail className="h-4 w-4" />
            Pending Invitations
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'members' ? (
          <MembersList
            companyId={companyId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        ) : (
          <InvitationsList companyId={companyId} />
        )}
      </div>

      {/* Invite Form Modal */}
      {showInviteForm && (
        <InviteFormModal companyId={companyId} onClose={() => setShowInviteForm(false)} />
      )}
    </div>
  )
}

/**
 * Members list component
 */
function MembersList({
  companyId,
  currentUserId,
  currentUserRole,
}: {
  companyId: string
  currentUserId: string
  currentUserRole: 'owner' | 'admin' | 'member'
}) {
  const { data: members, isLoading, error } = useCompanyMembers(companyId)
  const updateRole = useUpdateMemberRole()
  const removeMember = useRemoveMember()
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)

  const isAdmin = currentUserRole === 'owner' || currentUserRole === 'admin'

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <MemberSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center text-red-500 dark:text-red-400">Failed to load team members</div>
    )
  }

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'member') => {
    await updateRole.mutateAsync({ companyId, userId, role: newRole })
    setMenuOpenFor(null)
  }

  const handleRemove = async (userId: string) => {
    if (confirm('Are you sure you want to remove this member?')) {
      await removeMember.mutateAsync({ companyId, userId })
    }
    setMenuOpenFor(null)
  }

  return (
    <div className="space-y-2">
      {members?.map((member) => (
        <MemberCard
          key={member.id}
          member={member}
          isCurrentUser={member.userId === currentUserId}
          canManage={isAdmin && member.role !== 'owner' && member.userId !== currentUserId}
          isMenuOpen={menuOpenFor === member.id}
          onMenuToggle={() => setMenuOpenFor(menuOpenFor === member.id ? null : member.id)}
          onRoleChange={(role) => handleRoleChange(member.userId, role)}
          onRemove={() => handleRemove(member.userId)}
        />
      ))}
    </div>
  )
}

/**
 * Individual member card
 */
function MemberCard({
  member,
  isCurrentUser,
  canManage,
  isMenuOpen,
  onMenuToggle,
  onRoleChange,
  onRemove,
}: {
  member: CompanyMember
  isCurrentUser: boolean
  canManage: boolean
  isMenuOpen: boolean
  onMenuToggle: () => void
  onRoleChange: (role: 'admin' | 'member') => void
  onRemove: () => void
}) {
  const initials = member.email.slice(0, 2).toUpperCase()

  const RoleIcon = member.role === 'owner' ? Crown : member.role === 'admin' ? ShieldCheck : Shield
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
            <p className="font-medium text-gray-900 dark:text-dark-text-primary">{member.email}</p>
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
          <Button variant="ghost" size="icon" onClick={onMenuToggle} className="h-8 w-8">
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

/**
 * Member loading skeleton
 */
function MemberSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-1 h-4 w-20" />
        </div>
      </div>
    </div>
  )
}

/**
 * Invitations list component
 */
function InvitationsList({ companyId }: { companyId: string }) {
  const { data: invitations, isLoading, error } = usePendingInvitations(companyId)
  const cancelInvitation = useCancelInvitation()
  const resendInvitation = useResendInvitation()

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <MemberSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center text-red-500 dark:text-red-400">Failed to load invitations</div>
    )
  }

  if (!invitations?.length) {
    return (
      <div className="text-center text-gray-500 dark:text-dark-text-secondary py-8">
        <Mail className="mx-auto h-12 w-12 text-gray-300 dark:text-dark-text-tertiary" />
        <p className="mt-2">No pending invitations</p>
      </div>
    )
  }

  const handleCancel = async (invitationId: string) => {
    if (confirm('Are you sure you want to cancel this invitation?')) {
      await cancelInvitation.mutateAsync({ companyId, invitationId })
    }
  }

  const handleResend = async (invitationId: string) => {
    await resendInvitation.mutateAsync({ companyId, invitationId })
  }

  return (
    <div className="space-y-2">
      {invitations.map((invitation) => (
        <InvitationCard
          key={invitation.id}
          invitation={invitation}
          onCancel={() => handleCancel(invitation.id)}
          onResend={() => handleResend(invitation.id)}
          isCancelling={cancelInvitation.isPending}
          isResending={resendInvitation.isPending}
        />
      ))}
    </div>
  )
}

/**
 * Individual invitation card
 */
function InvitationCard({
  invitation,
  onCancel,
  onResend,
  isCancelling,
  isResending,
}: {
  invitation: Invitation
  onCancel: () => void
  onResend: () => void
  isCancelling: boolean
  isResending: boolean
}) {
  const expiresAt = new Date(invitation.expiresAt)
  const isExpiringSoon = expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-dark-tertiary">
          <Mail className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
        </div>
        <div>
          <p className="font-medium text-gray-900 dark:text-dark-text-primary">
            {invitation.email}
          </p>
          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-dark-text-secondary">
            <Clock className="h-3 w-3" />
            <span className={isExpiringSoon ? 'text-orange-500 dark:text-orange-400' : ''}>
              Expires {expiresAt.toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onResend}
          disabled={isResending}
          className="gap-1"
        >
          <RefreshCw className={cn('h-4 w-4', isResending && 'animate-spin')} />
          Resend
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isCancelling}
          className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-700 dark:hover:text-red-300"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Invite form modal
 */
function InviteFormModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const inviteMember = useInviteMember()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await inviteMember.mutateAsync({ companyId, email, role })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
            Invite Team Member
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 dark:text-dark-text-tertiary hover:bg-gray-100 dark:hover:bg-dark-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1"
            >
              Email address
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">
              Role
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole('member')}
                className={cn(
                  'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  role === 'member'
                    ? 'border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green'
                    : 'border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary'
                )}
              >
                <Shield className="mx-auto mb-1 h-5 w-5" />
                Member
              </button>
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={cn(
                  'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  role === 'admin'
                    ? 'border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green'
                    : 'border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary'
                )}
              >
                <ShieldCheck className="mx-auto mb-1 h-5 w-5" />
                Admin
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMember.isPending || !email}
              className="flex-1 bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TeamManagement
