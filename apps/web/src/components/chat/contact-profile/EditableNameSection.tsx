import { Check, Edit2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateContact } from "@/hooks/useContact";
import type { ContactData } from "./types";
import { useTranslation } from "react-i18next";

interface EditableNameSectionProps {
  contact: ContactData;
}

/**
 * Editable custom name section
 */
export function EditableNameSection({ contact }: EditableNameSectionProps) {
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [customName, setCustomName] = useState(contact.customName || "");
  const updateContact = useUpdateContact();

  useEffect(() => {
    setCustomName(contact.customName || "");
  }, [contact.customName]);

  const handleSave = async () => {
    await updateContact.mutateAsync({
      contactId: contact.id,
      customName: customName.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setCustomName(contact.customName || "");
    setIsEditing(false);
  };

  return (
    <RightPanelSection title={t("contacts.customName", "Custom Name")}>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={t(
              "contacts.customNamePlaceholder",
              "Enter custom name",
            )}
            className="flex-1 dark:bg-dark-tertiary dark:border-dark-border dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSave}
            disabled={updateContact.isPending}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
            aria-label={t("contacts.saveCustomName", "Save custom name")}
          >
            <Check
              className="h-4 w-4 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCancel}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
            aria-label={t("contacts.cancelEditing", "Cancel editing")}
          >
            <X
              className="h-4 w-4 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-700 dark:text-dark-text-primary">
            {contact.customName || (
              <span className="text-gray-400 dark:text-dark-text-tertiary italic">
                {t("contacts.noCustomName", "No custom name set")}
              </span>
            )}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8 dark:hover:bg-dark-tertiary"
            aria-label={t("contacts.editCustomName", "Edit custom name")}
          >
            <Edit2
              className="h-4 w-4 text-gray-500 dark:text-dark-text-secondary"
              aria-hidden="true"
            />
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-dark-text-tertiary">
        {t(
          "contacts.customNameVisible",
          "Custom name is visible to all team members",
        )}
      </p>
    </RightPanelSection>
  );
}
