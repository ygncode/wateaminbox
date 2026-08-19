import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateContact } from "@/hooks/useContact";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import {
  type AddContactFormData,
  addContactSchema,
} from "@/lib/schemas/contact";
import { formatPhoneLikeText } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog component for adding a new contact by phone number
 */
export function AddContactDialog({
  open,
  onOpenChange,
}: AddContactDialogProps) {
  const { t } = useTranslation();

  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  const createContact = useCreateContact();
  const { connections } = useWhatsAppConnections();
  const activeConnections = connections.filter(
    (connection) => connection.status === "connected",
  );
  const soleConnectionId =
    activeConnections.length === 1 ? activeConnections[0].id : undefined;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<AddContactFormData>({
    resolver: zodResolver(addContactSchema),
    defaultValues: {
      connectionId: undefined,
      phoneNumber: "",
      customName: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (soleConnectionId) setValue("connectionId", soleConnectionId);
  }, [soleConnectionId, setValue]);

  const resetForm = () => {
    reset();
    setServerError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const onSubmit = async (data: AddContactFormData) => {
    setServerError(null);

    try {
      const contact = await createContact.mutateAsync({
        phoneNumber: data.phoneNumber,
        connectionId: data.connectionId || activeConnections[0]?.id,
        customName: data.customName || undefined,
        notesShared: data.notes || undefined,
      });

      setSuccess(true);

      // Navigate to the new contact after a short delay
      setTimeout(() => {
        handleClose();
        navigate(`/chat/${contact.id}`);
      }, 1000);
    } catch (err) {
      if (err instanceof Error) {
        // Handle conflict error (contact already exists) - show as toast
        if (err.message.includes("already exists")) {
          toast.error(
            t(
              "contacts.duplicatePhone",
              "A contact with this phone number already exists",
            ),
          );
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError("Failed to create contact");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-whatsapp-teal-green" />
            {t("contacts.addNewTitle", "Add New Contact")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "contacts.addNewHint",
              "Enter a phone number to add a new contact. Include the country code (e.g., +1 for US).",
            )}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 dark:text-dark-text-primary">
              {t("contacts.created", "Contact Created!")}
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              {t("contacts.redirecting", "Redirecting to conversation...")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
            {/* Server error message */}
            {serverError && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            {activeConnections.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="connectionId">
                  WhatsApp account <span className="text-red-500">*</span>
                </Label>
                <select
                  id="connectionId"
                  required
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-elevated"
                  {...register("connectionId")}
                >
                  <option value="">
                    {t("connections.selectAccount", "Select an account")}
                  </option>
                  {activeConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {formatPhoneLikeText(
                        connection.name ||
                          connection.phoneNumber ||
                          connection.id,
                      )}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Phone Number Input */}
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">
                Phone Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="phoneNumber"
                type="tel"
                inputMode="tel"
                placeholder="+1234567890…"
                className="font-mono"
                autoComplete="tel"
                autoFocus
                data-testid="add-contact-phone"
                aria-invalid={errors.phoneNumber ? "true" : "false"}
                aria-describedby={
                  errors.phoneNumber ? "phoneNumber-error" : "phoneNumber-hint"
                }
                {...register("phoneNumber")}
              />
              {errors.phoneNumber ? (
                <p
                  id="phoneNumber-error"
                  className="text-xs text-red-500 dark:text-red-400"
                  role="alert"
                >
                  {errors.phoneNumber.message}
                </p>
              ) : (
                <p
                  id="phoneNumber-hint"
                  className="text-xs text-gray-500 dark:text-dark-text-tertiary"
                >
                  {t(
                    "contacts.countryCodeHint",
                    "Include country code (e.g., +1 for US, +44 for UK, +95 for Myanmar)",
                  )}
                </p>
              )}
            </div>

            {/* Custom Name Input */}
            <div className="space-y-2">
              <Label htmlFor="customName">
                {t("contacts.nameOptional", "Name (Optional)")}
              </Label>
              <Input
                id="customName"
                type="text"
                placeholder={t("contacts.namePlaceholder", "John Doe")}
                autoComplete="name"
                data-testid="add-contact-name"
                aria-invalid={errors.customName ? "true" : "false"}
                aria-describedby={
                  errors.customName ? "customName-error" : undefined
                }
                {...register("customName")}
              />
              {errors.customName && (
                <p
                  id="customName-error"
                  className="text-xs text-red-500 dark:text-red-400"
                  role="alert"
                >
                  {errors.customName.message}
                </p>
              )}
            </div>

            {/* Notes Input */}
            <div className="space-y-2">
              <Label htmlFor="notes">
                {t("contacts.notesOptional", "Notes (Optional)")}
              </Label>
              <Textarea
                id="notes"
                placeholder={t(
                  "contacts.notesPlaceholder",
                  "Add notes about this contact…",
                )}
                rows={3}
                autoComplete="off"
                data-testid="add-contact-notes"
                aria-invalid={errors.notes ? "true" : "false"}
                aria-describedby={errors.notes ? "notes-error" : "notes-hint"}
                {...register("notes")}
              />
              {errors.notes ? (
                <p
                  id="notes-error"
                  className="text-xs text-red-500 dark:text-red-400"
                  role="alert"
                >
                  {errors.notes.message}
                </p>
              ) : (
                <p
                  id="notes-hint"
                  className="text-xs text-gray-500 dark:text-dark-text-tertiary"
                >
                  {t(
                    "contacts.notesVisibleHint",
                    "These notes will be visible to all team members",
                  )}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={createContact.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createContact.isPending || activeConnections.length === 0
                }
                className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
                data-testid="add-contact-submit"
              >
                {createContact.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    {t("contacts.addContact", "Add Contact")}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddContactDialog;
