import { useState, useEffect } from "react";
import {
  RightPanel,
  RightPanelHeader,
  RightPanelContent,
  RightPanelSection,
} from "@/components/layout/right-panel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Input,
  Skeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@/components/ui";
import {
  useGroup,
  useUpdateGroup,
  useGroupAdminStatus,
  usePromoteParticipant,
  useDemoteParticipant,
  useRemoveParticipant,
  useUpdateGroupSettings,
  type GroupDetail,
  type GroupParticipant,
} from "@/hooks/useGroups";
import {
  Users,
  Edit2,
  Check,
  X,
  Tag,
  Shield,
  User,
  FileText,
  Calendar,
  MoreVertical,
  ShieldPlus,
  ShieldMinus,
  UserMinus,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
          <div className="p-4 text-center text-red-500">
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

/**
 * Loading skeleton for the group info panel
 */
function GroupInfoPanelSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center gap-4 py-8">
        <Skeleton className="h-32 w-32 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * Group header with avatar and display name
 */
function GroupHeader({ group, isAdmin }: { group: GroupDetail; isAdmin: boolean }) {
  const initials = group.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50 py-8">
      <Avatar className="h-32 w-32 border-4 border-white shadow-lg">
        <AvatarImage
          src={group.profilePictureUrl || undefined}
          alt={group.displayName}
        />
        <AvatarFallback className="bg-gray-400 text-3xl text-white">
          {group.profilePictureUrl ? initials : <Users className="h-12 w-12" />}
        </AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900">
          {group.displayName}
        </h3>
        {group.customName && group.name && group.customName !== group.name && (
          <p className="text-sm text-gray-500">~{group.name}</p>
        )}
        <p className="text-sm text-gray-500 mt-1">
          <Users className="inline h-4 w-4 mr-1" />
          {group.participantCount} participants
        </p>
        {isAdmin && (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-700 text-xs flex items-center gap-1 mt-2"
          >
            <Shield className="h-3 w-3" />
            You are Admin
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Editable custom name section
 */
function EditableNameSection({ group }: { group: GroupDetail }) {
  const [isEditing, setIsEditing] = useState(false);
  const [customName, setCustomName] = useState(group.customName || "");
  const updateGroup = useUpdateGroup();

  useEffect(() => {
    setCustomName(group.customName || "");
  }, [group.customName]);

  const handleSave = async () => {
    await updateGroup.mutateAsync({
      groupId: group.id,
      customName: customName.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setCustomName(group.customName || "");
    setIsEditing(false);
  };

  return (
    <RightPanelSection title="Custom Name">
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Enter custom name"
            className="flex-1"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSave}
            disabled={updateGroup.isPending}
            className="h-8 w-8"
          >
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCancel}
            className="h-8 w-8"
          >
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-700">
            {group.customName || (
              <span className="text-gray-400 italic">No custom name set</span>
            )}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8"
          >
            <Edit2 className="h-4 w-4 text-gray-500" />
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Custom name is visible to all team members
      </p>
    </RightPanelSection>
  );
}

/**
 * Group settings section for admins
 */
function GroupSettingsSection({ group }: { group: GroupDetail }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(group.name || "");
  const [description, setDescription] = useState(group.description || "");
  const updateSettings = useUpdateGroupSettings();

  useEffect(() => {
    setName(group.name || "");
    setDescription(group.description || "");
  }, [group.name, group.description]);

  const handleSave = async () => {
    await updateSettings.mutateAsync({
      groupId: group.id,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
    });
    setIsOpen(false);
  };

  const handleCancel = () => {
    setName(group.name || "");
    setDescription(group.description || "");
    setIsOpen(false);
  };

  return (
    <>
      <RightPanelSection title="Group Settings">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          Edit Group Settings
        </Button>
        <p className="mt-1 text-xs text-gray-500">
          Change group name and description on WhatsApp
        </p>
      </RightPanelSection>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group Settings</DialogTitle>
            <DialogDescription>
              Update the group name and description. These changes will be
              reflected on WhatsApp for all members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Group Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter group name"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter group description"
                rows={4}
                maxLength={512}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateSettings.isPending}
            >
              {updateSettings.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Group description section
 */
function DescriptionSection({ group }: { group: GroupDetail }) {
  return (
    <RightPanelSection title="Description">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 text-gray-400 flex-shrink-0" />
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {group.description}
        </p>
      </div>
    </RightPanelSection>
  );
}

/**
 * Group info section with creation date
 */
function GroupInfoSection({ group }: { group: GroupDetail }) {
  const createdDate = new Date(group.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <RightPanelSection>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">Created</p>
            <p className="text-xs text-gray-500">{createdDate}</p>
          </div>
        </div>
        {group.createdBy && (
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">Created by</p>
              <p className="text-xs text-gray-500">{group.createdBy}</p>
            </div>
          </div>
        )}
      </div>
    </RightPanelSection>
  );
}

/**
 * Participants section with admin badges
 */
function ParticipantsSection({
  groupId,
  participants,
  participantCount,
  isAdmin,
  connectionJid,
}: {
  groupId: string;
  participants: GroupParticipant[];
  participantCount: number;
  isAdmin: boolean;
  connectionJid: string | null | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayLimit = 10;
  const displayedParticipants = showAll
    ? participants
    : participants.slice(0, displayLimit);
  const hasMore = participants.length > displayLimit;

  // Sort admins first
  const sortedParticipants = [...displayedParticipants].sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1;
    if (!a.isAdmin && b.isAdmin) return 1;
    return 0;
  });

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
  );
}

/**
 * Individual participant item with admin actions
 */
function ParticipantItem({
  groupId,
  participant,
  isAdmin,
  isSelf,
}: {
  groupId: string;
  participant: GroupParticipant;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const promoteParticipant = usePromoteParticipant();
  const demoteParticipant = useDemoteParticipant();
  const removeParticipant = useRemoveParticipant();

  // Extract phone number from JID
  const phoneNumber = participant.jid.split("@")[0];
  const displayName = formatPhoneNumber(phoneNumber);

  const handlePromote = async () => {
    await promoteParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    });
    setIsMenuOpen(false);
  };

  const handleDemote = async () => {
    await demoteParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    });
    setIsMenuOpen(false);
  };

  const handleRemove = async () => {
    await removeParticipant.mutateAsync({
      groupId,
      participantJid: participant.jid,
    });
    setConfirmRemove(false);
    setIsMenuOpen(false);
  };

  const isPending =
    promoteParticipant.isPending ||
    demoteParticipant.isPending ||
    removeParticipant.isPending;

  return (
    <>
      <div className="flex items-center gap-3 py-2 group">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-gray-200 text-gray-600 text-sm">
            <User className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">
              {displayName}
              {isSelf && (
                <span className="text-gray-500 ml-1">(You)</span>
              )}
            </p>
            {participant.isAdmin && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-700 text-xs flex items-center gap-1"
              >
                <Shield className="h-3 w-3" />
                Admin
              </Badge>
            )}
          </div>
          {participant.joinedAt && (
            <p className="text-xs text-gray-500">
              Joined{" "}
              {new Date(participant.joinedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
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
                <MoreVertical className="h-4 w-4 text-gray-500" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              <div className="flex flex-col">
                {participant.isAdmin ? (
                  <button
                    onClick={handleDemote}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50"
                  >
                    <ShieldMinus className="h-4 w-4 text-amber-600" />
                    Remove as Admin
                  </button>
                ) : (
                  <button
                    onClick={handlePromote}
                    disabled={isPending}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50"
                  >
                    <ShieldPlus className="h-4 w-4 text-green-600" />
                    Make Admin
                  </button>
                )}
                <button
                  onClick={() => {
                    setConfirmRemove(true);
                    setIsMenuOpen(false);
                  }}
                  disabled={isPending}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md disabled:opacity-50"
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
              {removeParticipant.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone: string): string {
  // Basic formatting - can be enhanced
  if (phone.length > 10) {
    return `+${phone}`;
  }
  return phone;
}

/**
 * Tags section
 */
function TagsSection({
  tags,
}: {
  tags: { id: string; name: string; color: string | null }[];
}) {
  if (tags.length === 0) {
    return (
      <RightPanelSection title="Tags">
        <div className="flex items-start gap-2">
          <Tag className="mt-0.5 h-4 w-4 text-gray-400" />
          <p className="text-sm text-gray-400 italic">No tags assigned</p>
        </div>
      </RightPanelSection>
    );
  }

  return (
    <RightPanelSection title="Tags">
      <div className="flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-gray-400" />
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className={cn("cursor-default")}
              style={
                tag.color
                  ? { backgroundColor: `${tag.color}20`, color: tag.color }
                  : undefined
              }
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      </div>
    </RightPanelSection>
  );
}

export default GroupInfoPanel;
