/**
 * WhatsApp Connection Panel components
 *
 * Main export:
 * - WhatsAppConnectionPanel: Main component supporting single and multi-connection modes
 *
 * Sub-components (for advanced usage):
 * - MultiConnectionPanel: Multi-connection management panel
 * - SingleConnectionPanel: Legacy single-connection panel
 * - GlobalErrorBanner: Error banner for connection limits
 * - AddConnectionDialog: Dialog for adding new connections
 */

export {
  WhatsAppConnectionPanel,
  WhatsAppConnectionPanel as default,
} from "./WhatsAppConnectionPanel";
export { MultiConnectionPanel } from "./MultiConnectionPanel";
export { SingleConnectionPanel } from "./SingleConnectionPanel";
export { GlobalErrorBanner } from "./GlobalErrorBanner";
export { AddConnectionDialog } from "./AddConnectionDialog";
export type {
  WhatsAppConnectionPanelProps,
  MultiConnectionPanelProps,
  SingleConnectionPanelProps,
  GlobalErrorBannerProps,
  AddConnectionDialogProps,
} from "./types";
