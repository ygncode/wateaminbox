/**
 * Shared types for WhatsApp connection panel components
 */

export interface WhatsAppConnectionPanelProps {
  className?: string;
  compact?: boolean;
  multiConnection?: boolean;
  hideHeader?: boolean;
}

export interface MultiConnectionPanelProps {
  className?: string;
  compact?: boolean;
  hideHeader?: boolean;
}

export interface SingleConnectionPanelProps {
  className?: string;
  compact?: boolean;
}

export interface GlobalErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export interface AddConnectionDialogProps {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isCreating: boolean;
}
