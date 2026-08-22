import { useAuth } from "@/contexts/auth-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { useContact } from "@/hooks/contact";
import { useConversationState } from "@/hooks/useConversationLifecycle";
import {
  type ComposerAccessState,
  resolveComposerAccess,
} from "@/components/chat/composer-access";

/**
 * Combines conversation lifecycle status, contact assignment, and
 * can_send_messages/can_assign_contacts into one composer-gating decision
 * (see resolveComposerAccess for the priority rules, including why the
 * "loading" state must never be skipped). Server is authoritative on every
 * invariant here - this only decides what the composer LOOKS like; every
 * interactive send route independently re-enforces all of them (see
 * requireSendAccess on the API side).
 */
export function useComposerAccess(contactId: string | null): {
  access: ComposerAccessState;
} {
  const { can } = useWorkspace();
  const { user } = useAuth();
  const { data: lifecycleState, isLoading: lifecycleLoading } =
    useConversationState(contactId);
  const { data: contact, isLoading: contactLoading } = useContact(contactId);

  const isLoading =
    !contactId || !user?.id || lifecycleLoading || contactLoading;

  const access = resolveComposerAccess({
    isLoading,
    lifecycleStatus: lifecycleState?.status ?? null,
    isBlocked: contact?.isBlocked ?? false,
    assignedTo: contact?.assignment?.assignedTo ?? null,
    assignedToName: contact?.assignment?.assignedToName ?? null,
    currentUserId: user?.id ?? "",
    canSendMessages: can("can_send_messages"),
    canAssignContacts: can("can_assign_contacts"),
  });

  return { access };
}
