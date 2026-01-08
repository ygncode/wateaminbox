import type { useContact } from "@/hooks/useContact";

export interface ContactProfileProps {
  contactId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export type ContactData = NonNullable<ReturnType<typeof useContact>["data"]>;
