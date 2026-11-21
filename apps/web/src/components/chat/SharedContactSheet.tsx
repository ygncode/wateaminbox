import { Loader2, MessageCircle, Phone } from "lucide-react";
import { useRef } from "react";
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
  const lastContactRef = useRef<SharedContactCard | null>(contact);
  if (contact) lastContactRef.current = contact;
  const renderedContact = contact ?? lastContactRef.current;
  const primaryPhone = renderedContact?.phoneNumbers[0]?.value;

  return (
    <MobileSlideInPanel
      isOpen={Boolean(contact)}
      onClose={onClose}
      position="bottom"
      title={t("chat.contactInfo", "Contact info")}
      className="sm:inset-x-auto sm:start-1/2 sm:-ms-[15rem] sm:w-[30rem]"
    >
      {renderedContact && (
        <div className="flex min-h-full flex-col bg-page">
          <div className="flex flex-col items-center bg-surface px-6 pb-6 pt-7">
            <div className="size-24 overflow-hidden rounded-full shadow-md ring-1 ring-fg/[0.06]">
              <IdentityAvatarFallback
                displayName={renderedContact.displayName}
                identity={primaryPhone || renderedContact.displayName}
                className="text-2xl"
              />
            </div>
            <h3 className="mt-4 max-w-full truncate text-xl font-semibold text-fg">
              {renderedContact.displayName}
            </h3>

            <Button
              type="button"
              onClick={() => onMessage(renderedContact)}
              disabled={!primaryPhone || isMessaging}
              className="mt-5 min-w-32 rounded-full bg-primary px-6 text-on-primary hover:bg-primary-hover"
            >
              {isMessaging ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircle aria-hidden="true" />
              )}
              {t("chat.messageContact", "Message")}
            </Button>
          </div>

          <div className="mt-2 bg-surface px-4 py-2">
            {renderedContact.phoneNumbers.length > 0 ? (
              renderedContact.phoneNumbers.map((phone, index) => (
                <a
                  key={`${phone.value}-${index}`}
                  href={`tel:${phone.value}`}
                  className="flex min-h-14 items-center gap-3 border-b border-line px-1 text-fg outline-none last:border-b-0 hover:text-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Phone
                    className="size-5 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium tabular-nums">
                    {formatPhoneNumber(phone.value)}
                  </span>
                  {phone.label && (
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {phone.label}
                    </span>
                  )}
                </a>
              ))
            ) : (
              <p className="py-5 text-center text-sm text-fg-muted">
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
