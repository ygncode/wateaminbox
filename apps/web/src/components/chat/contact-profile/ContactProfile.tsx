import { Download } from "lucide-react";
import { useState } from "react";
import { ExportDialog } from "@/components/export";
import {
  RightPanel,
  RightPanelContent,
  RightPanelHeader,
  RightPanelSection,
} from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { useContact } from "@/hooks/useContact";
import type { ContactProfileProps } from "./types";
import { ContactProfileSkeleton } from "./ContactProfileSkeleton";
import { ProfileHeader } from "./ProfileHeader";
import { ContactInfoSection } from "./ContactInfoSection";
import { EditableNameSection } from "./EditableNameSection";
import { SharedNotesSection, PrivateNotesSection } from "./NotesPanel";
import { TagsSection } from "./TagsSection";
import { AssignmentSection } from "./AssignmentSection";
import { AssignmentHistorySection } from "./AssignmentHistorySection";
import { BlockStatusSection } from "./BlockStatusSection";
import { NotificationMuteSection } from "./NotificationMuteSection";

/**
 * Contact Profile Panel - shows detailed contact information
 * with editable fields for custom name, shared notes, and private notes
 */
export function ContactProfile({
  contactId,
  isOpen,
  onClose,
}: ContactProfileProps) {
  const { data: contact, isLoading, error } = useContact(contactId);
  const [showExportDialog, setShowExportDialog] = useState(false);

  if (!contactId) return null;

  return (
    <RightPanel isOpen={isOpen} onClose={onClose}>
      <RightPanelHeader title="Contact Info" onClose={onClose} />
      <RightPanelContent>
        {isLoading ? (
          <ContactProfileSkeleton />
        ) : error ? (
          <div className="p-4 text-center text-red-500 dark:text-red-400">
            Failed to load contact information
          </div>
        ) : contact ? (
          <>
            {/* Profile Header */}
            <ProfileHeader contact={contact} />

            {/* Contact Info Section */}
            <ContactInfoSection contact={contact} />

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
            <RightPanelSection title="Export">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
                  Download this conversation as CSV or JSON
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
