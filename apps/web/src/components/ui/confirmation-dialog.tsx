import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";

export interface ConfirmationDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean;
  /**
   * Called when open state changes
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Dialog title
   */
  title: string;
  /**
   * Dialog description/message
   */
  description: string;
  /**
   * Text for confirm button
   * @default "Confirm"
   */
  confirmText?: string;
  /**
   * Text for cancel button
   * @default "Cancel"
   */
  cancelText?: string;
  /**
   * Called when user confirms
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Called when user cancels (optional, defaults to closing dialog)
   */
  onCancel?: () => void;
  /**
   * Whether the action is destructive (shows red confirm button)
   * @default false
   */
  isDestructive?: boolean;
  /**
   * Whether confirm action is in progress
   * @default false
   */
  isLoading?: boolean;
  /**
   * Optional data-testid for the confirm button
   */
  confirmTestId?: string;
}

/**
 * Reusable confirmation dialog component
 *
 * @example
 * ```tsx
 * <ConfirmationDialog
 *   open={showDelete}
 *   onOpenChange={setShowDelete}
 *   title="Delete Message"
 *   description="Are you sure you want to delete this message? This action cannot be undone."
 *   confirmText="Delete"
 *   onConfirm={handleDelete}
 *   isDestructive
 *   isLoading={isDeleting}
 * />
 * ```
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDestructive = false,
  isLoading = false,
  confirmTestId,
}: ConfirmationDialogProps) {
  const handleCancel = React.useCallback(() => {
    if (onCancel) {
      onCancel();
    } else {
      onOpenChange(false);
    }
  }, [onCancel, onOpenChange]);

  const handleConfirm = React.useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isLoading}
            className="gap-2"
            data-testid={confirmTestId}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
