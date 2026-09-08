import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportDialog } from "@/components/export";
import {
  RightPanel,
  RightPanelContent,
  RightPanelHeader,
  RightPanelSection,
} from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { useChannelConversation } from "@/hooks/useChannelConversations";
import { useContact } from "@/hooks/useContact";
import { useGroup } from "@/hooks/useGroups";
import type { ChannelConversation } from "@/lib/api/channel-conversations";
import { AssignmentHistorySection } from "./AssignmentHistorySection";
import { AssignmentSection } from "./AssignmentSection";
import { BlockStatusSection } from "./BlockStatusSection";
import { ContactInfoSection } from "./ContactInfoSection";
import { ContactProfileSkeleton } from "./ContactProfileSkeleton";
import { EditableNameSection } from "./EditableNameSection";
import { GroupInfoSections } from "./GroupInfoSections";
import { PrivateNotesSection, SharedNotesSection } from "./NotesPanel";
import { NotificationMuteSection } from "./NotificationMuteSection";
import { ProfileHeader } from "./ProfileHeader";
import { TagsSection } from "./TagsSection";
import type { ContactData, ContactProfileProps } from "./types";

/**
 * Contact Profile Panel - shows detailed contact information
 * with editable fields for custom name, shared notes, and private notes
 */
export function ContactProfile({
  contactId,
  isOpen,
  onClose,
  onMessage,
  onOpenParticipantProfile,
}: ContactProfileProps) {
  const { t } = useTranslation();

  const { data: contact, isLoading, error } = useContact(contactId);
  const { data: channelConversation, isLoading: isConversationLoading } =
    useChannelConversation(contactId && error ? contactId : null);
  const conversationContact = channelConversation
    ? conversationProfileContact(channelConversation)
    : undefined;
  const profileContact = contact ?? conversationContact;
  const isProfileLoading =
    isLoading || Boolean(error && isConversationLoading && !profileContact);
  const {
    data: group,
    isLoading: isGroupLoading,
    error: groupError,
  } = useGroup(contact?.isGroup ? contactId : null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  if (!contactId) return null;

  return (
    <RightPanel isOpen={isOpen} onClose={onClose}>
      <RightPanelHeader
        title={
          profileContact?.isGroup
            ? t("contacts.groupInfo", "Group Info")
            : t("contacts.contactInfo", "Contact Info")
        }
        onClose={onClose}
      />
      <RightPanelContent>
        {isProfileLoading ? (
          <ContactProfileSkeleton />
        ) : !profileContact ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            {t(
              "contacts.profileLoadFailed",
              "Failed to load contact information",
            )}
          </div>
        ) : (
          <>
            {/* Profile Header */}
            <ProfileHeader contact={profileContact} onMessage={onMessage} />

            {contact ? <ContactInfoSection contact={contact} /> : null}

            {contact?.isGroup && (
              <GroupInfoSections
                group={group}
                isLoading={isGroupLoading}
                error={groupError}
                onOpenParticipantProfile={onOpenParticipantProfile}
              />
            )}

            {contact ? <EditableNameSection contact={contact} /> : null}
            {contact ? <SharedNotesSection contactId={contact.id} /> : null}
            {contact ? <PrivateNotesSection contactId={contact.id} /> : null}
            {contact ? <TagsSection contact={contact} /> : null}
            {contact ? <AssignmentSection contact={contact} /> : null}
            {contact ? (
              <AssignmentHistorySection contactId={contact.id} />
            ) : null}

            <NotificationMuteSection contact={profileContact} />

            {contact ? <BlockStatusSection contact={contact} /> : null}

            {contact ? (
              <RightPanelSection title={t("export.title", "Export")}>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
                    {t(
                      "contacts.downloadConversation",
                      "Download this conversation as CSV or JSON",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowExportDialog(true)}
                    className="gap-1 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </Button>
                </div>
              </RightPanelSection>
            ) : null}

            {contact ? (
              <ExportDialog
                open={showExportDialog}
                onOpenChange={setShowExportDialog}
                type="conversation"
                contactId={contact.id}
                contactName={contact.displayName}
              />
            ) : null}
          </>
        )}
      </RightPanelContent>
    </RightPanel>
  );
}

function conversationProfileContact(
  conversation: ChannelConversation,
): ContactData {
  const name = conversation.subject?.trim() || conversation.channel;
  return {
    id: conversation.id,
    jid: null,
    phoneNumber: null,
    pushName: null,
    customName: null,
    displayName: name,
    isGroup: conversation.kind !== "direct",
    isBlocked: false,
    isOnline: false,
    lastSeen: null,
    profilePictureUrl: null,
    notesShared: null,
    createdAt: conversation.firstMessageAt ?? new Date().toISOString(),
    updatedAt: conversation.lastMessageAt ?? new Date().toISOString(),
    conversationId: conversation.id,
    channel: conversation.channel,
    provider: conversation.provider,
    connection: null,
    assignment: null,
    tags: [],
  };
}

export default ContactProfile;
