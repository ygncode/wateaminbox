import {
  RightPanel,
  RightPanelContent,
  RightPanelHeader,
} from "@/components/layout/right-panel";
import { useGroup, useGroupAdminStatus } from "@/hooks/useGroups";
import {
  DescriptionSection,
  EditableNameSection,
  GroupHeader,
  GroupInfoPanelSkeleton,
  GroupInfoSection,
  GroupSettingsSection,
  ParticipantsSection,
  TagsSection,
} from "./info-panel";

export interface GroupInfoPanelProps {
  groupId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Group Info Panel - shows detailed group information
 * with editable custom name, participant list, and tags
 */
export function GroupInfoPanel({
  groupId,
  isOpen,
  onClose,
}: GroupInfoPanelProps) {
  const { data: group, isLoading, error } = useGroup(groupId);
  const { data: adminStatus } = useGroupAdminStatus(groupId);

  const isAdmin = adminStatus?.isAdmin ?? false;
  const connectionJid = adminStatus?.connectionJid;

  if (!groupId) return null;

  return (
    <RightPanel isOpen={isOpen} onClose={onClose}>
      <RightPanelHeader title="Group Info" onClose={onClose} />
      <RightPanelContent>
        {isLoading ? (
          <GroupInfoPanelSkeleton />
        ) : error ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            Failed to load group information
          </div>
        ) : group ? (
          <>
            {/* Profile Header */}
            <GroupHeader group={group} isAdmin={isAdmin} />

            {/* Custom Name Section */}
            <EditableNameSection group={group} />

            {/* Group Settings Section (Admin only) */}
            {isAdmin && <GroupSettingsSection group={group} />}

            {/* Description Section */}
            {group.description && <DescriptionSection group={group} />}

            {/* Group Info Section */}
            <GroupInfoSection group={group} />

            {/* Participants Section */}
            <ParticipantsSection
              groupId={group.id}
              participants={group.participants}
              participantCount={group.participantCount}
              isAdmin={isAdmin}
              connectionJid={connectionJid}
            />

            {/* Tags Section */}
            <TagsSection tags={group.tags} />
          </>
        ) : null}
      </RightPanelContent>
    </RightPanel>
  );
}

export default GroupInfoPanel;
