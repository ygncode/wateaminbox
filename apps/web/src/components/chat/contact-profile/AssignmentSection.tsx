import { formatShortDate } from "@wateaminbox/shared";
import { Loader2, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useConversationAssignment,
  useConversationAssignmentMutations,
} from "@/hooks/useConversationMetadata";
import { useAssignContact, useUnassignContact } from "@/hooks/useContact";
import { useTeamMemberIdentities } from "@/hooks/useTeam";
import type { ContactData } from "./types";

interface AssignmentSectionProps {
  contact: ContactData;
}

const UNASSIGNED_VALUE = "unassigned";

/** Assign or transfer a conversation while preserving the simple self-claim flow. */
export function AssignmentSection({ contact }: AssignmentSectionProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeWorkspaceId, can } = useWorkspace();
  const canAssignOthers = can("can_assign_contacts");
  const identities = useTeamMemberIdentities(
    canAssignOthers ? activeWorkspaceId : null,
  );
  const assignContact = useAssignContact();
  const unassignContact = useUnassignContact();
  const isPending = assignContact.isPending || unassignContact.isPending;

  const assignedTo = contact.assignment?.assignedTo ?? null;
  const members = identities.data ?? [];
  const currentAssigneeIsMissing =
    contact.assignment &&
    !members.some((member) => member.userId === contact.assignment?.assignedTo);

  const assignmentError = (error: unknown) =>
    toast.error(
      error instanceof Error
        ? error.message
        : t("contacts.assignmentError", "Could not update assignment"),
    );

  const handleAssignToMe = async () => {
    try {
      await assignContact.mutateAsync({ contactId: contact.id });
      toast.success(t("contacts.assignedToYou", "Assigned to you"));
    } catch (error) {
      assignmentError(error);
    }
  };

  const handleAssignmentChange = async (target: string) => {
    if (target === (assignedTo ?? UNASSIGNED_VALUE)) return;

    try {
      if (target === UNASSIGNED_VALUE) {
        await unassignContact.mutateAsync(contact.id);
        toast.success(
          t("contacts.unassignedSuccess", "Conversation unassigned"),
        );
        return;
      }

      await assignContact.mutateAsync({
        contactId: contact.id,
        targetUserId: target,
      });
      const member = members.find((candidate) => candidate.userId === target);
      toast.success(
        target === user?.id
          ? t("contacts.assignedToYou", "Assigned to you")
          : t("contacts.assignedToMember", "Assigned to {{name}}", {
              name: member?.name ?? t("contacts.teamMember", "team member"),
            }),
      );
    } catch (error) {
      assignmentError(error);
    }
  };

  return (
    <RightPanelSection title={t("contacts.assignment", "Assignment")}>
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-dark-tertiary dark:text-dark-text-secondary">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-700 dark:text-dark-text-primary">
              {contact.assignment
                ? contact.assignment.assignedToName
                : t("contacts.unassigned", "Unassigned")}
            </p>
            <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
              {contact.assignment
                ? t("contacts.assignedSince", "Assigned since {{date}}", {
                    date: formatShortDate(contact.assignment.assignedAt),
                  })
                : t(
                    "contacts.unassignedHint",
                    "Anyone with access can pick this up",
                  )}
            </p>
          </div>
        </div>

        {canAssignOthers ? (
          <div className="space-y-1.5">
            <label
              htmlFor={`contact-assignee-${contact.id}`}
              className="text-xs font-medium text-gray-500 dark:text-dark-text-secondary"
            >
              {t("contacts.assignConversationTo", "Assign conversation to")}
            </label>
            <Select
              value={assignedTo ?? UNASSIGNED_VALUE}
              onValueChange={(value) => void handleAssignmentChange(value)}
              disabled={isPending || identities.isLoading || identities.isError}
            >
              <SelectTrigger
                id={`contact-assignee-${contact.id}`}
                className="h-9"
                aria-label={t(
                  "contacts.assignConversationTo",
                  "Assign conversation to",
                )}
              >
                <SelectValue />
                {isPending && (
                  <Loader2
                    className="ml-auto h-3.5 w-3.5 animate-spin text-gray-400"
                    aria-hidden="true"
                  />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>
                  {t("contacts.unassigned", "Unassigned")}
                </SelectItem>
                <SelectSeparator />
                {currentAssigneeIsMissing && contact.assignment && (
                  <SelectItem value={contact.assignment.assignedTo} disabled>
                    {contact.assignment.assignedToName}
                  </SelectItem>
                )}
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.userId === user?.id
                      ? t("contacts.youWithName", "You · {{name}}", {
                          name: member.name,
                        })
                      : member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {identities.isError && (
              <button
                type="button"
                className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                onClick={() => void identities.refetch()}
              >
                {t(
                  "contacts.membersLoadError",
                  "Could not load teammates. Retry",
                )}
              </button>
            )}
          </div>
        ) : !contact.assignment ? (
          <Button
            size="sm"
            onClick={() => void handleAssignToMe()}
            disabled={isPending}
            className="w-full bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            {assignContact.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1 h-4 w-4" />
            )}
            {t("contacts.assignToMe", "Assign to me")}
          </Button>
        ) : null}
      </div>
    </RightPanelSection>
  );
}

export function ConversationAssignmentSection({
  conversationId,
}: {
  conversationId: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { can } = useWorkspace();
  const canAssignOthers = can("can_assign_contacts");
  const { activeWorkspaceId } = useWorkspace();
  const identities = useTeamMemberIdentities(
    canAssignOthers ? activeWorkspaceId : null,
  );
  const { data: assignment } = useConversationAssignment(conversationId);
  const { assign, unassign } =
    useConversationAssignmentMutations(conversationId);
  const isPending = assign.isPending || unassign.isPending;
  const assignedTo = assignment?.assigned_to ?? null;
  const members = identities.data ?? [];
  const assignedToName =
    members.find((member) => member.userId === assignedTo)?.name ??
    (assignedTo === user?.id
      ? t("contacts.you", "You")
      : t("contacts.teamMember", "team member"));

  const assignmentError = (error: unknown) =>
    toast.error(
      error instanceof Error
        ? error.message
        : t("contacts.assignmentError", "Could not update assignment"),
    );

  const handleAssignmentChange = async (target: string) => {
    if (target === (assignedTo ?? UNASSIGNED_VALUE)) return;
    try {
      if (target === UNASSIGNED_VALUE) {
        await unassign.mutateAsync();
        toast.success(
          t("contacts.unassignedSuccess", "Conversation unassigned"),
        );
        return;
      }
      await assign.mutateAsync(target);
      toast.success(
        target === user?.id
          ? t("contacts.assignedToYou", "Assigned to you")
          : t("contacts.assignedToMember", "Assigned to {{name}}", {
              name:
                members.find((member) => member.userId === target)?.name ??
                t("contacts.teamMember", "team member"),
            }),
      );
    } catch (error) {
      assignmentError(error);
    }
  };

  return (
    <RightPanelSection title={t("contacts.assignment", "Assignment")}>
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-dark-tertiary dark:text-dark-text-secondary">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-700 dark:text-dark-text-primary">
              {assignment
                ? assignedToName
                : t("contacts.unassigned", "Unassigned")}
            </p>
            <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
              {assignment
                ? t("contacts.assignedSince", "Assigned since {{date}}", {
                    date: formatShortDate(assignment.assigned_at),
                  })
                : t(
                    "contacts.unassignedHint",
                    "Anyone with access can pick this up",
                  )}
            </p>
          </div>
        </div>
        {canAssignOthers ? (
          <Select
            value={assignedTo ?? UNASSIGNED_VALUE}
            onValueChange={(value) => void handleAssignmentChange(value)}
            disabled={isPending || identities.isLoading}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_VALUE}>
                {t("contacts.unassigned", "Unassigned")}
              </SelectItem>
              <SelectSeparator />
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.userId === user?.id
                    ? t("contacts.youWithName", "You · {{name}}", {
                        name: member.name,
                      })
                    : member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : !assignment ? (
          <Button
            size="sm"
            onClick={() =>
              void assign.mutateAsync(undefined).catch(assignmentError)
            }
            disabled={isPending}
            className="w-full bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            {assign.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1 h-4 w-4" />
            )}
            {t("contacts.assignToMe", "Assign to me")}
          </Button>
        ) : null}
      </div>
    </RightPanelSection>
  );
}
