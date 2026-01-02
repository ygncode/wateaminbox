import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { UserPlus, Loader2, AlertCircle, Check } from "lucide-react";
import { useCreateContact } from "@/hooks/useContact";
import { useNavigate } from "react-router-dom";

export interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog component for adding a new contact by phone number
 */
export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [customName, setCustomName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  const createContact = useCreateContact();

  const resetForm = () => {
    setPhoneNumber("");
    setCustomName("");
    setNotes("");
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const validatePhoneNumber = (phone: string): boolean => {
    // Remove all non-digit characters except +
    const cleaned = phone.replace(/[^\d+]/g, "");
    // Check minimum length (country code + number)
    if (cleaned.length < 7) {
      setError("Phone number is too short. Include country code (e.g., +1234567890)");
      return false;
    }
    if (cleaned.length > 16) {
      setError("Phone number is too long");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!phoneNumber.trim()) {
      setError("Phone number is required");
      return;
    }

    if (!validatePhoneNumber(phoneNumber)) {
      return;
    }

    try {
      const contact = await createContact.mutateAsync({
        phoneNumber: phoneNumber.trim(),
        customName: customName.trim() || undefined,
        notesShared: notes.trim() || undefined,
      });

      setSuccess(true);

      // Navigate to the new contact after a short delay
      setTimeout(() => {
        handleClose();
        navigate(`/chat/${contact.id}`);
      }, 1000);
    } catch (err) {
      if (err instanceof Error) {
        // Handle conflict error (contact already exists)
        if (err.message.includes("already exists")) {
          setError("A contact with this phone number already exists");
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to create contact");
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
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium text-gray-900">Contact Created!</p>
            <p className="text-sm text-gray-500 mt-1">
              Redirecting to conversation...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
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
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="font-mono"
                autoFocus
                data-testid="add-contact-phone"
              />
              <p className="text-xs text-gray-500">
                Include country code (e.g., +1 for US, +44 for UK, +95 for Myanmar)
              </p>
            </div>

            {/* Custom Name Input */}
            <div className="space-y-2">
              <Label htmlFor="customName">Name (Optional)</Label>
              <Input
                id="customName"
                type="text"
                placeholder="John Doe"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                data-testid="add-contact-name"
              />
            </div>

            {/* Notes Input */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this contact..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                data-testid="add-contact-notes"
              />
              <p className="text-xs text-gray-500">
                These notes will be visible to all team members
              </p>
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
                disabled={createContact.isPending || !phoneNumber.trim()}
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
