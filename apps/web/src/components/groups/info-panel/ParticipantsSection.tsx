import { useState } from 'react'
import {
  RightPanelSection,
} from '@/components/layout/right-panel'
import { ParticipantItem } from './ParticipantItem'
import type { ParticipantsSectionProps } from './types'

/**
 * Participants section with admin badges
 */
export function ParticipantsSection({
  groupId,
  participants,
  participantCount,
  isAdmin,
  connectionJid,
}: ParticipantsSectionProps) {
  const [showAll, setShowAll] = useState(false)
  const displayLimit = 10
  const displayedParticipants = showAll
    ? participants
    : participants.slice(0, displayLimit)
  const hasMore = participants.length > displayLimit

  // Sort admins first
  const sortedParticipants = [...displayedParticipants].sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1
    if (!a.isAdmin && b.isAdmin) return 1
    return 0
  })

  return (
    <RightPanelSection title={`${participantCount} Participants`}>
      <div className="space-y-2">
        {sortedParticipants.map((participant) => (
          <ParticipantItem
            key={participant.jid}
            groupId={groupId}
            participant={participant}
            isAdmin={isAdmin}
            isSelf={participant.jid === connectionJid}
          />
        ))}

        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full py-2 text-sm text-whatsapp-teal-green hover:underline"
          >
            Show all {participants.length} participants
          </button>
        )}

        {showAll && hasMore && (
          <button
            onClick={() => setShowAll(false)}
            className="w-full py-2 text-sm text-whatsapp-teal-green hover:underline"
          >
            Show less
          </button>
        )}
      </div>
    </RightPanelSection>
  )
}
