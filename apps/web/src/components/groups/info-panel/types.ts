import type { GroupDetail, GroupParticipant } from '@/hooks/useGroups'

export type { GroupDetail, GroupParticipant }

export interface GroupHeaderProps {
  group: GroupDetail
  isAdmin: boolean
}

export interface EditableNameSectionProps {
  group: GroupDetail
}

export interface GroupSettingsSectionProps {
  group: GroupDetail
}

export interface DescriptionSectionProps {
  group: GroupDetail
}

export interface GroupInfoSectionProps {
  group: GroupDetail
}

export interface ParticipantsSectionProps {
  groupId: string
  participants: GroupParticipant[]
  participantCount: number
  isAdmin: boolean
  connectionJid: string | null | undefined
}

export interface ParticipantItemProps {
  groupId: string
  participant: GroupParticipant
  isAdmin: boolean
  isSelf: boolean
}

export interface TagsSectionProps {
  tags: { id: string; name: string; color: string | null }[]
}
