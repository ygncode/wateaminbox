/**
 * Re-export from connection-panel directory for backwards compatibility
 *
 * @deprecated Import from '@/components/whatsapp/connection-panel' instead
 */
export {
  WhatsAppConnectionPanel,
  WhatsAppConnectionPanel as default,
  MultiConnectionPanel,
  SingleConnectionPanel,
  GlobalErrorBanner,
  AddConnectionDialog,
} from "./connection-panel";

export type {
  WhatsAppConnectionPanelProps,
  MultiConnectionPanelProps,
  SingleConnectionPanelProps,
  GlobalErrorBannerProps,
  AddConnectionDialogProps,
} from "./connection-panel";
