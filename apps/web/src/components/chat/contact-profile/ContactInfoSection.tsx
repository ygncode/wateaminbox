import { AtSign, Phone, Smartphone, User } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { formatPhoneNumber } from "@/lib/utils";
import { channelLabel } from "../ChannelIdentity";
import { ConnectionBadge, getConnectionPhone } from "../ConnectionIdentity";
import type { ContactData } from "./types";
import { useTranslation } from "react-i18next";

interface ContactInfoSectionProps {
  contact: ContactData;
}

/**
 * Contact info section showing phone number and WhatsApp name
 */
export function ContactInfoSection({ contact }: ContactInfoSectionProps) {
  const { t } = useTranslation();
  // A merged customer keeps whichever record survived, and that record can be
  // the Telegram one. Naming the network from the contact rather than from a
  // hardcoded string stops the panel captioning a Telegram handle "WhatsApp".
  const network = channelLabel(contact.channel);

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
        {contact.connection && (
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div className="min-w-0">
              <ConnectionBadge connection={contact.connection} />
              <p className="mt-1 truncate text-xs text-gray-500 dark:text-dark-text-tertiary">
                Receives on{" "}
                {getConnectionPhone(contact.connection) || "this account"}
              </p>
            </div>
          </div>
        )}
        {contact.username && (
          <div className="flex items-center gap-3">
            <AtSign className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                @{contact.username}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                {network
                  ? t("contacts.channelUsername", {
                      channel: network,
                      defaultValue: "{{channel}} username",
                    })
                  : t("contacts.usernameLabel", "Username")}
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
                {network
                  ? t("contacts.channelProfileName", {
                      channel: network,
                      defaultValue: "{{channel}} name",
                    })
                  : t("contacts.profileNameLabel", "Profile name")}
              </p>
            </div>
          </div>
        )}
      </div>
    </RightPanelSection>
  );
}
