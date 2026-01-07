import { AlertCircle, Check, Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { useCreateContact } from "@/hooks/useContact";
import { addContactSchema, type AddContactFormData } from "@/lib/schemas";

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
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  const createContact = useCreateContact();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddContactFormData>({
    resolver: zodResolver(addContactSchema),
    defaultValues: {
      phoneNumber: "",
      customName: "",
      notes: "",
    },
  });

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
          toast.error("A contact with this phone number already exists");
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
            Add New Contact
          </DialogTitle>
          <DialogDescription>
            Enter a phone number to add a new contact. Include the country code
            (e.g., +1 for US).
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 dark:text-dark-text-primary">
              Contact Created!
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              Redirecting to conversation...
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

            {/* Phone Number Input */}
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">
                Phone Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="+1234567890"
                className="font-mono"
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
                  Include country code (e.g., +1 for US, +44 for UK, +95 for
                  Myanmar)
                </p>
              )}
            </div>

            {/* Custom Name Input */}
            <div className="space-y-2">
              <Label htmlFor="customName">Name (Optional)</Label>
              <Input
                id="customName"
                type="text"
                placeholder="John Doe"
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
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this contact..."
                rows={3}
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
                  These notes will be visible to all team members
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
                disabled={createContact.isPending}
                className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
                data-testid="add-contact-submit"
              >
                {createContact.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add Contact
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
