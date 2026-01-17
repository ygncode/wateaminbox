import { UserMinus, UserPlus } from "lucide-react";
import { formatShortDate } from "@wateaminbox/shared";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { useAssignContact, useUnassignContact } from "@/hooks/useContact";
import type { ContactData } from "./types";

interface AssignmentSectionProps {
  contact: ContactData;
}

/**
 * Assignment section - assign/unassign contact to current user
 */
export function AssignmentSection({ contact }: AssignmentSectionProps) {
  const assignContact = useAssignContact();
  const unassignContact = useUnassignContact();

  const handleAssign = async () => {
    await assignContact.mutateAsync(contact.id);
  };

  const handleUnassign = async () => {
    await unassignContact.mutateAsync(contact.id);
  };

  return (
    <RightPanelSection title="Assignment">
      <div className="flex items-center justify-between">
        {contact.assignment ? (
          <>
            <div>
              <p className="text-sm text-gray-700 dark:text-dark-text-primary">
                Assigned to:{" "}
                <span className="font-medium">
                  {contact.assignment.assignedToName}
                </span>
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Since {formatShortDate(contact.assignment.assignedAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUnassign}
              disabled={unassignContact.isPending}
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-400/50 dark:hover:bg-red-400/10 dark:hover:text-red-300"
            >
              <UserMinus className="mr-1 h-4 w-4" />
              Unassign
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm italic text-gray-400 dark:text-dark-text-tertiary">
              Not assigned to anyone
            </p>
            <Button
              size="sm"
              onClick={handleAssign}
              disabled={assignContact.isPending}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              <UserPlus className="mr-1 h-4 w-4" />
              Assign to me
            </Button>
          </>
        )}
      </div>
    </RightPanelSection>
  );
}
