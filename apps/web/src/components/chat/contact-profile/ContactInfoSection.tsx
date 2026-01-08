import { Phone, User } from "lucide-react";
import { formatPhoneNumber } from "@/lib/utils";
import { RightPanelSection } from "@/components/layout/right-panel";
import type { ContactData } from "./types";

interface ContactInfoSectionProps {
  contact: ContactData;
}

/**
 * Contact info section showing phone number and WhatsApp name
 */
export function ContactInfoSection({ contact }: ContactInfoSectionProps) {
  return (
    <RightPanelSection>
      <div className="space-y-3">
        {contact.phoneNumber && (
          <div className="flex items-center gap-3">
            <Phone className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                {formatPhoneNumber(contact.phoneNumber)}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Phone
              </p>
            </div>
          </div>
        )}
        {contact.pushName && (
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                {contact.pushName}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                WhatsApp Name
              </p>
            </div>
          </div>
        )}
      </div>
    </RightPanelSection>
  );
}
