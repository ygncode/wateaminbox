import { MultiConnectionPanel } from './MultiConnectionPanel'
import { SingleConnectionPanel } from './SingleConnectionPanel'
import type { WhatsAppConnectionPanelProps } from './types'

/**
 * WhatsApp Connection Panel
 * Displays QR code for linking device and connection status
 * Supports both single connection (legacy) and multi-connection modes
 */
export function WhatsAppConnectionPanel({
  className,
  compact = false,
  multiConnection = false,
  hideHeader = false,
}: WhatsAppConnectionPanelProps) {
  // Use multi-connection mode if enabled
  if (multiConnection) {
    return (
      <MultiConnectionPanel
        className={className}
        compact={compact}
        hideHeader={hideHeader}
      />
    )
  }

  // Legacy single-connection mode
  return <SingleConnectionPanel className={className} compact={compact} />
}

export default WhatsAppConnectionPanel
