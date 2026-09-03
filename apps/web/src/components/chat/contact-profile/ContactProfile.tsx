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
import { useContact } from "@/hooks/useContact";
import { useGroup } from "@/hooks/useGroups";
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
import type { ContactProfileProps } from "./types";

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
          contact?.isGroup
            ? t("contacts.groupInfo", "Group Info")
            : t("contacts.contactInfo", "Contact Info")
        }
        onClose={onClose}
      />
      <RightPanelContent>
        {isLoading ? (
          <ContactProfileSkeleton />
        ) : error ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            {t(
              "contacts.profileLoadFailed",
              "Failed to load contact information",
            )}
          </div>
        ) : contact ? (
          <>
            {/* Profile Header */}
            <ProfileHeader contact={contact} onMessage={onMessage} />

            {/* Contact Info Section */}
            <ContactInfoSection contact={contact} />

            {contact.isGroup && (
              <GroupInfoSections
                group={group}
                isLoading={isGroupLoading}
                error={groupError}
                onOpenParticipantProfile={onOpenParticipantProfile}
              />
            )}

            {/* Custom Name Section */}
            <EditableNameSection contact={contact} />

            {/* Shared Notes Section */}
            <SharedNotesSection contactId={contact.id} />

            {/* Private Notes Section */}
            <PrivateNotesSection contactId={contact.id} />

            {/* Tags Section */}
            <TagsSection contact={contact} />

            {/* Assignment Section */}
            <AssignmentSection contact={contact} />

            {/* Assignment History Section */}
            <AssignmentHistorySection contactId={contact.id} />

            <NotificationMuteSection contact={contact} />

            {/* Block Status Section - hidden for groups */}
            <BlockStatusSection contact={contact} />

            {/* Export Conversation Section */}
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

            {/* Export Dialog */}
            <ExportDialog
              open={showExportDialog}
              onOpenChange={setShowExportDialog}
              type="conversation"
              contactId={contact.id}
              contactName={contact.displayName}
            />
          </>
        ) : null}
      </RightPanelContent>
    </RightPanel>
  );
}

export default ContactProfile;
