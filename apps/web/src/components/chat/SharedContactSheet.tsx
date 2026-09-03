import { Loader2, MessageCircle, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import type { SharedContactCard } from "@/contexts/message-actions-context";
import { formatPhoneNumber } from "@/lib/utils";
import { MobileSlideInPanel } from "../layout/MobileLayout";

interface SharedContactSheetProps {
  contact: SharedContactCard | null;
  onClose: () => void;
  onMessage: (contact: SharedContactCard) => void;
  isMessaging?: boolean;
}

/** WhatsApp-style contact preview that always rises from the bottom. */
export function SharedContactSheet({
  contact,
  onClose,
  onMessage,
  isMessaging = false,
}: SharedContactSheetProps) {
  const { t } = useTranslation();
  const primaryPhone = contact?.phoneNumbers[0]?.value;

  return (
    <MobileSlideInPanel
      isOpen={Boolean(contact)}
      onClose={onClose}
      position="bottom"
      title={t("chat.contactInfo", "Contact info")}
      className="sm:inset-x-auto sm:left-1/2 sm:w-[30rem] sm:-translate-x-1/2"
    >
      {contact && (
        <div className="flex min-h-full flex-col bg-[#f0f2f5] dark:bg-dark-primary">
          <div className="flex flex-col items-center bg-white px-6 pb-6 pt-7 dark:bg-dark-secondary">
            <div className="size-24 overflow-hidden rounded-full shadow-md ring-1 ring-black/[0.06] dark:ring-white/10">
              <IdentityAvatarFallback
                displayName={contact.displayName}
                identity={primaryPhone || contact.displayName}
                className="text-2xl"
              />
            </div>
            <h3 className="mt-4 max-w-full truncate text-xl font-semibold text-[#111b21] dark:text-dark-text-primary">
              {contact.displayName}
            </h3>

            <Button
              type="button"
              onClick={() => onMessage(contact)}
              disabled={!primaryPhone || isMessaging}
              className="mt-5 min-w-32 rounded-full bg-[#00a884] px-6 text-white hover:bg-[#008f72]"
            >
              {isMessaging ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircle aria-hidden="true" />
              )}
              {t("chat.messageContact", "Message")}
            </Button>
          </div>

          <div className="mt-2 bg-white px-4 py-2 dark:bg-dark-secondary">
            {contact.phoneNumbers.length > 0 ? (
              contact.phoneNumbers.map((phone, index) => (
                <a
                  key={`${phone.value}-${index}`}
                  href={`tel:${phone.value}`}
                  className="flex min-h-14 items-center gap-3 border-b border-black/[0.06] px-1 text-[#111b21] outline-none last:border-b-0 hover:text-[#008069] focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:border-white/[0.07] dark:text-dark-text-primary dark:hover:text-[#53bdeb]"
                >
                  <Phone
                    className="size-5 shrink-0 text-[#00a884]"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium tabular-nums">
                    {formatPhoneNumber(phone.value)}
                  </span>
                  {phone.label && (
                    <span className="shrink-0 text-xs text-[#667781] dark:text-dark-text-tertiary">
                      {phone.label}
                    </span>
                  )}
                </a>
              ))
            ) : (
              <p className="py-5 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
                {t(
                  "chat.contactDetailsUnavailable",
                  "Phone number unavailable",
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </MobileSlideInPanel>
  );
}
