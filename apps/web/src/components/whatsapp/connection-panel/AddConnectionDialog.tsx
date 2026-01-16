import { Link2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddConnectionDialogProps } from "./types";

/**
 * Dialog for adding a new WhatsApp connection
 */
export function AddConnectionDialog({
  name,
  onNameChange,
  onSubmit,
  onCancel,
  isCreating,
}: AddConnectionDialogProps) {
  return (
    <div className="mb-6 animate-slide-down">
      <div className="relative overflow-hidden rounded-xl border border-whatsapp-teal-green/20 dark:border-whatsapp-teal-green/30 bg-white dark:bg-dark-elevated p-5 shadow-xl">
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-whatsapp-teal-green flex items-center justify-center shadow-lg">
              <Link2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
                Add New Connection
              </h3>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                Link a new WhatsApp device
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-dark-text-secondary mb-1.5">
                Connection Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="e.g., Support Team, Sales Phone…"
                autoComplete="off"
                className="w-full px-4 py-2.5 bg-white dark:bg-dark-tertiary border border-gray-200 dark:border-dark-border rounded-lg text-sm text-gray-900 dark:text-dark-text-primary placeholder:text-gray-400 dark:placeholder:text-dark-text-tertiary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green/50 focus:border-whatsapp-teal-green transition-all duration-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmit();
                  if (e.key === "Escape") onCancel();
                }}
              />
              <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-1.5">
                Optional – helps identify this connection
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={onSubmit}
                disabled={isCreating}
                className="flex-1 bg-whatsapp-teal-green hover:bg-whatsapp-dark-green text-white shadow-lg transition-all duration-300"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Connection
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
                className="px-4 border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-tertiary"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
