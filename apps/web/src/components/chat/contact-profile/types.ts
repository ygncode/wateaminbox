import type { useContact } from "@/hooks/useContact";

export interface ContactProfileProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Open this contact's conversation from a member profile sheet. */
  onMessage?: () => void;
  /**
   * Re-point this panel at a group member. Omitted where the host has no way
   * to switch the panel's subject, in which case member rows stay static text
   * rather than becoming controls that do nothing.
   */
  onOpenParticipantProfile?: (participantContactId: string) => void;
  /**
   * Open one of the customer's other threads. Omitted where the host cannot
   * switch chats, in which case the merged-chat rows stay plain text.
   */
  onSelectThread?: (chatId: string) => void;
}

export type ContactData = NonNullable<ReturnType<typeof useContact>["data"]>;
