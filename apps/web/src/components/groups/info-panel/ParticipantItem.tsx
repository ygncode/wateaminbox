import {
  MoreVertical,
  Shield,
  ShieldMinus,
  ShieldPlus,
  User,
  UserMinus,
} from 'lucide-react'
import { useState } from 'react'
import { dayjs, formatPhoneNumber } from '@whatsapp-web/shared'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui'
import {
  useDemoteParticipant,
  usePromoteParticipant,
  useRemoveParticipant,
} from '@/hooks/useGroups'
import type { ParticipantItemProps } from './types'

/**
 * Individual participant item with admin actions
 */
export function ParticipantItem({
  groupId,
  participant,
  isAdmin,
  isSelf,
}: ParticipantItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const promoteParticipant = usePromoteParticipant()
  const demoteParticipant = useDemoteParticipant()
  const removeParticipant = useRemoveParticipant()

  // Extract phone number from JID
  const phoneNumber = participant.jid.split('@')[0]
  const displayName = formatPhoneNumber(phoneNumber)

  const handlePromote = async () => {
    await promoteParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    })
    setIsMenuOpen(false)
  }

  const handleDemote = async () => {
    await demoteParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    })
    setIsMenuOpen(false)
  }

  const handleRemove = async () => {
    await removeParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    })
    setConfirmRemove(false)
    setIsMenuOpen(false)
  }

  const isPending =
    promoteParticipant.isPending ||
    demoteParticipant.isPending ||
    removeParticipant.isPending

  return (
    <>
      <div className="flex items-center gap-3 py-2 group">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-gray-200 dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary text-sm">
            <User className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate">
              {displayName}
              {isSelf && <span className="text-gray-500 dark:text-dark-text-secondary ml-1">(You)</span>}
            </p>
            {participant.isAdmin && (
              <Badge
                variant="secondary"
                className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-1"
              >
                <Shield className="h-3 w-3" />
                Admin
              </Badge>
            )}
          </div>
          {participant.joinedAt && (
            <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
              Joined {dayjs(participant.joinedAt).format('MMM D, YYYY')}
            </p>
          )}
        </div>

        {/* Admin actions menu */}
        {isAdmin && !isSelf && (
          <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid={`participant-menu-${participant.jid}`}
              >
                <MoreVertical className="h-4 w-4 text-gray-500 dark:text-dark-text-secondary" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              <div className="flex flex-col">
                {participant.isAdmin ? (
                  <button
                    onClick={handleDemote}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-md disabled:opacity-50"
                  >
                    <ShieldMinus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    Remove as Admin
                  </button>
                ) : (
                  <button
                    onClick={handlePromote}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-md disabled:opacity-50"
                  >
                    <ShieldPlus className="h-4 w-4 text-green-600 dark:text-green-400" />
                    Make Admin
                  </button>
                )}
                <button
                  onClick={() => {
                    setConfirmRemove(true)
                    setIsMenuOpen(false)
                  }}
                  disabled={isPending}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md disabled:opacity-50"
                >
                  <UserMinus className="h-4 w-4" />
                  Remove from Group
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Remove confirmation dialog */}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Participant</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {displayName} from this group?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={removeParticipant.isPending}
            >
              {removeParticipant.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
