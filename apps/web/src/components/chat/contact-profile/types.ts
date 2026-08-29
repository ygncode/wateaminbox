import type { useContact } from "@/hooks/useContact";

export interface ContactProfileProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Re-point this panel at a group member. Omitted where the host has no way
   * to switch the panel's subject, in which case member rows stay static text
   * rather than becoming controls that do nothing.
   */
  onOpenParticipantProfile?: (participantContactId: string) => void;
}

export type ContactData = NonNullable<ReturnType<typeof useContact>["data"]>;
