import { useState } from "react";
import { Ban, CheckCircle } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button, ConfirmationDialog } from "@/components/ui";
import { useBlockContact } from "@/hooks/useContact";
import type { ContactData } from "./types";

interface BlockStatusSectionProps {
  contact: ContactData;
}

/**
 * Block status section - block/unblock individual contacts
 * Hidden for group contacts since WhatsApp only supports blocking individuals
 */
export function BlockStatusSection({ contact }: BlockStatusSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const blockContact = useBlockContact();

  // Don't show for groups - WhatsApp only allows blocking individuals
  if (contact.isGroup) {
    return null;
  }

  const handleBlock = () => {
    setShowConfirmDialog(true);
  };

  const handleConfirmBlock = async () => {
    await blockContact.mutateAsync({
      contactId: contact.id,
      isBlocked: true,
    });
    setShowConfirmDialog(false);
  };

  const handleUnblock = async () => {
    await blockContact.mutateAsync({
      contactId: contact.id,
      isBlocked: false,
    });
  };

  return (
    <>
      <RightPanelSection title="Block Status">
        <div className="flex items-center justify-between">
          {contact.isBlocked ? (
            <>
              <div className="flex items-center gap-2">
                <Ban className="h-4 w-4 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Contact Blocked
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                    Messages from this contact are blocked
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnblock}
                disabled={blockContact.isPending}
                className="text-whatsapp-green hover:bg-green-50 hover:text-whatsapp-dark-green dark:text-green-400 dark:border-green-400/50 dark:hover:bg-green-400/10 dark:hover:text-green-300"
              >
                <CheckCircle className="mr-1 h-4 w-4" />
                Unblock
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-sm text-gray-700 dark:text-dark-text-primary">
                    Not Blocked
                  </p>
                  <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                    You can receive messages from this contact
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBlock}
                disabled={blockContact.isPending}
                className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-400/50 dark:hover:bg-red-400/10 dark:hover:text-red-300"
              >
                <Ban className="mr-1 h-4 w-4" />
                Block
              </Button>
            </>
          )}
        </div>
      </RightPanelSection>

      <ConfirmationDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        title="Block Contact"
        description={`Are you sure you want to block ${contact.displayName}? You will no longer receive messages from this contact.`}
        confirmText="Block"
        cancelText="Cancel"
        isDestructive
        isLoading={blockContact.isPending}
        onConfirm={handleConfirmBlock}
      />
    </>
  );
}
