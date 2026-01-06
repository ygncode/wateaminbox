import {
  AlertCircle,
  CheckCircle2,
  Edit2,
  Link2,
  Loader2,
  MessageCircle,
  MoreVertical,
  Plus,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Skeleton } from '@/components/ui'
import { useWhatsAppConnection, type WhatsAppConnectionState } from '@/hooks/useWhatsAppConnection'
import { type ConnectionWithState, useWhatsAppConnections } from '@/hooks/useWhatsAppConnections'
import { cn } from '@/lib/utils'

// CSS-in-JS styles for animations
const animationStyles = `
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes pulse-ring {
    0% {
      transform: scale(0.95);
      opacity: 0.5;
    }
    50% {
      transform: scale(1);
      opacity: 0.3;
    }
    100% {
      transform: scale(0.95);
      opacity: 0.5;
    }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .animate-slide-down {
    animation: slideDown 0.3s ease-out forwards;
  }

  .animate-fade-in {
    animation: fadeIn 0.2s ease-out forwards;
  }

  .animate-pulse-ring {
    animation: pulse-ring 2s ease-in-out infinite;
  }

  .animate-float {
    animation: float 3s ease-in-out infinite;
  }

  .animate-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
  }
`

interface WhatsAppConnectionPanelProps {
  className?: string
  compact?: boolean
  multiConnection?: boolean
  hideHeader?: boolean
}

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
    return <MultiConnectionPanel className={className} compact={compact} hideHeader={hideHeader} />
  }

  // Legacy single-connection mode
  return <SingleConnectionPanel className={className} compact={compact} />
}

// =====================
// Multi-Connection Panel
// =====================

function MultiConnectionPanel({
  className,
  compact = false,
  hideHeader = false,
}: {
  className?: string
  compact?: boolean
  hideHeader?: boolean
}) {
  const {
    connections,
    pendingConnection,
    globalError,
    isLoading,
    isCreating,
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    refresh,
    clearError,
    clearPendingConnection,
    clearGlobalError,
    connectedCount,
    totalCount,
  } = useWhatsAppConnections()

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newConnectionName, setNewConnectionName] = useState('')
  const [editingConnection, setEditingConnection] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // Inject animation styles into document head
  useEffect(() => {
    const styleId = 'whatsapp-connection-panel-styles'
    // Avoid duplicate style injection
    if (document.getElementById(styleId)) return

    const styleEl = document.createElement('style')
    styleEl.id = styleId
    styleEl.textContent = animationStyles
    document.head.appendChild(styleEl)

    return () => {
      const existing = document.getElementById(styleId)
      if (existing) existing.remove()
    }
  }, [])

  // Handle add new connection
  const handleAddConnection = useCallback(async () => {
    try {
      await create(newConnectionName || undefined)
      setNewConnectionName('')
      setShowAddDialog(false)
    } catch (_error) {
      // Error is handled by the hook
    }
  }, [create, newConnectionName])

  // Handle rename connection
  const handleRename = useCallback(
    async (connectionId: string) => {
      if (editName.trim()) {
        await rename(connectionId, editName.trim())
        setEditingConnection(null)
        setEditName('')
      }
    },
    [rename, editName]
  )

  if (isLoading) {
    return (
      <div className={cn('p-6', className)}>
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="flex items-center gap-1">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              connectedCount > 0 ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'
            )}
          />
          <span className="text-sm text-gray-600 dark:text-dark-text-secondary">
            {connectedCount}/{totalCount} connected
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        hideHeader
          ? 'p-4'
          : 'bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6',
        className
      )}
    >
      {/* Header - hidden when wrapped in SettingsCard */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
                WhatsApp Connections
              </h2>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                {connectedCount} of {totalCount} connections active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              disabled={isCreating}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Connection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Minimal action bar when header is hidden */}
      {hideHeader && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
            {connectedCount} of {totalCount} connections active
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              disabled={isCreating}
              className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Connection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Global Error Banner (e.g., max connections exceeded) */}
      {globalError && (
        <div className="mb-6 animate-slide-down">
          <div className="relative overflow-hidden rounded-xl border border-amber-300/50 dark:border-amber-700/50 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-900/30 dark:via-orange-900/30 dark:to-amber-900/30 p-4 shadow-lg shadow-amber-100/50 dark:shadow-amber-900/20">
            {/* Decorative shimmer overlay */}
            <div className="absolute inset-0 animate-shimmer opacity-30 pointer-events-none" />

            <div className="relative flex items-start gap-4">
              {/* Animated icon with pulse ring */}
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-pulse-ring" />
                <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
                  <Zap className="h-6 w-6 text-white" />
                </div>
              </div>

              <div className="flex-1 pt-1">
                <h3 className="text-base font-semibold text-amber-900 dark:text-amber-300 tracking-tight">
                  Connection Limit Reached
                </h3>
                <p className="text-sm text-amber-700/90 dark:text-amber-400/90 mt-1 leading-relaxed">
                  {globalError}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 bg-amber-200/50 dark:bg-amber-800/50 hover:bg-amber-200 dark:hover:bg-amber-700/50 px-3 py-1.5 rounded-full transition-all duration-200">
                    <Sparkles className="h-3.5 w-3.5" />
                    Upgrade Plan
                  </button>
                  <span className="text-amber-400">•</span>
                  <button
                    onClick={clearGlobalError}
                    className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={clearGlobalError}
                className="flex-shrink-0 p-1.5 rounded-full hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <div className="mb-6 animate-slide-down">
          <div className="relative overflow-hidden rounded-xl border border-whatsapp-teal-green/20 dark:border-whatsapp-teal-green/30 bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/50 dark:from-dark-elevated dark:via-emerald-900/10 dark:to-teal-900/10 p-5 shadow-xl shadow-emerald-100/30 dark:shadow-emerald-900/10">
            {/* Decorative corner accent */}
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-whatsapp-teal-green/10 to-transparent rounded-full blur-2xl" />

            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-whatsapp-teal-green to-whatsapp-dark-green flex items-center justify-center shadow-lg shadow-emerald-500/20">
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
                    value={newConnectionName}
                    onChange={(e) => setNewConnectionName(e.target.value)}
                    placeholder="e.g., Support Team, Sales Phone..."
                    className="w-full px-4 py-2.5 bg-white dark:bg-dark-tertiary border border-gray-200 dark:border-dark-border rounded-lg text-sm text-gray-900 dark:text-dark-text-primary placeholder:text-gray-400 dark:placeholder:text-dark-text-tertiary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green/50 focus:border-whatsapp-teal-green transition-all duration-200"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddConnection()
                      if (e.key === 'Escape') {
                        setShowAddDialog(false)
                        setNewConnectionName('')
                      }
                    }}
                  />
                  <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-1.5">
                    Optional – helps identify this connection
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={handleAddConnection}
                    disabled={isCreating}
                    className="flex-1 bg-gradient-to-r from-whatsapp-teal-green to-whatsapp-dark-green hover:from-whatsapp-dark-green hover:to-whatsapp-teal-green text-white shadow-lg shadow-emerald-500/20 transition-all duration-300"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
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
                    onClick={() => {
                      setShowAddDialog(false)
                      setNewConnectionName('')
                    }}
                    className="px-4 border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-tertiary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Connection with QR */}
      {pendingConnection?.qrCode && (
        <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-900/30">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <QRCodeDisplay
                qrCode={pendingConnection.qrCode}
                expiresAt={pendingConnection.qrExpiresAt}
                onRefresh={() => {}}
                isRefreshing={false}
              />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900 dark:text-dark-text-primary mb-2">
                Scan to connect new device
              </h3>
              <ol className="text-xs text-gray-600 dark:text-dark-text-secondary space-y-1">
                <li>1. Open WhatsApp on your phone</li>
                <li>2. Tap Menu or Settings</li>
                <li>3. Select Linked Devices</li>
                <li>4. Point your phone at this QR code</li>
              </ol>
              <Button size="sm" variant="ghost" className="mt-3" onClick={clearPendingConnection}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Connections List */}
      {connections.length === 0 && !pendingConnection ? (
        <EmptyConnectionsView onAdd={() => setShowAddDialog(true)} isCreating={isCreating} />
      ) : (
        <div className="space-y-3 overflow-visible">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              isEditing={editingConnection === connection.id}
              editName={editName}
              onEditNameChange={setEditName}
              onStartEdit={() => {
                setEditingConnection(connection.id)
                setEditName(connection.name)
              }}
              onCancelEdit={() => {
                setEditingConnection(null)
                setEditName('')
              }}
              onSaveEdit={() => handleRename(connection.id)}
              onReconnect={() => reconnect(connection.id)}
              onDisconnect={() => disconnect(connection.id)}
              onDelete={() => remove(connection.id)}
              onClearError={() => clearError(connection.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Connection Card Component
function ConnectionCard({
  connection,
  isEditing,
  editName,
  onEditNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onReconnect,
  onDisconnect,
  onDelete,
  onClearError,
}: {
  connection: ConnectionWithState
  isEditing: boolean
  editName: string
  onEditNameChange: (name: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onReconnect: () => void
  onDisconnect: () => void
  onDelete: () => void
  onClearError: () => void
}) {
  const { localState } = connection
  const [showMenu, setShowMenu] = useState(false)
  const [countdown, setCountdown] = useState<number>(0)

  // Countdown for QR expiry
  useEffect(() => {
    if (!localState.qrExpiresAt) {
      setCountdown(0)
      return
    }

    const updateCountdown = () => {
      const expiresAt = localState.qrExpiresAt
      if (!expiresAt) return
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setCountdown(remaining)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [localState.qrExpiresAt])

  const statusColor = {
    connected: 'bg-green-100 text-green-800 border-green-200',
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    disconnected: 'bg-gray-100 text-gray-800 border-gray-200',
    banned: 'bg-red-100 text-red-800 border-red-200',
    error: 'bg-red-100 text-red-800 border-red-200',
  }[connection.status]

  const statusIcon = {
    connected: <Wifi className="h-3 w-3" />,
    pending: <Loader2 className="h-3 w-3 animate-spin" />,
    disconnected: <WifiOff className="h-3 w-3" />,
    banned: <XCircle className="h-3 w-3" />,
    error: <XCircle className="h-3 w-3" />,
  }[connection.status]

  return (
    <div
      className={cn(
        'border rounded-lg p-4 transition-colors overflow-visible',
        connection.status === 'connected'
          ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated'
      )}
    >
      <div className="flex items-start justify-between overflow-visible">
        <div className="flex items-start gap-3 flex-1">
          {/* Status Icon */}
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              connection.status === 'connected'
                ? 'bg-green-100 dark:bg-green-900/50'
                : 'bg-gray-100 dark:bg-dark-tertiary'
            )}
          >
            {connection.status === 'connected' ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : connection.status === 'pending' || localState.isConnecting ? (
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            ) : (
              <Smartphone className="h-5 w-5 text-gray-400" />
            )}
          </div>

          {/* Connection Info */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 dark:border-dark-border rounded text-sm bg-white dark:bg-dark-tertiary text-gray-900 dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSaveEdit()
                    if (e.key === 'Escape') onCancelEdit()
                  }}
                />
                <Button size="sm" onClick={onSaveEdit}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate">
                    {connection.name}
                  </h3>
                  <Badge className={cn('text-xs', statusColor)}>
                    {statusIcon}
                    <span className="ml-1 capitalize">{connection.status}</span>
                  </Badge>
                </div>
                {connection.phoneNumber && (
                  <p className="text-sm text-whatsapp-teal-green font-medium mt-0.5">
                    {connection.phoneNumber}
                  </p>
                )}
                {connection.lastSync && (
                  <p className="text-xs text-gray-500 dark:text-dark-text-tertiary mt-0.5">
                    Last sync: {new Date(connection.lastSync).toLocaleString()}
                  </p>
                )}
              </>
            )}

            {/* Error Message */}
            {localState.error && (
              <div className="mt-3 animate-fade-in">
                <div className="relative overflow-hidden rounded-lg border border-red-200/60 dark:border-red-800/60 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/30 dark:to-rose-900/30 p-3 shadow-sm">
                  {/* Decorative accent line */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-red-400 to-rose-500" />

                  <div className="flex items-start gap-2.5 pl-2">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-800 dark:text-red-300">
                        Connection Error
                      </p>
                      <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5 leading-relaxed">
                        {localState.error}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={onReconnect}
                          className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 bg-red-100 dark:bg-red-900/50 hover:bg-red-200/70 dark:hover:bg-red-800/50 px-2.5 py-1 rounded-md transition-all duration-200"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                        <button
                          onClick={onClearError}
                          className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={onClearError}
                      className="flex-shrink-0 p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-all"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* QR Code for pending connection */}
            {localState.qrCode && (
              <div className="mt-3">
                <QRCodeDisplay
                  qrCode={localState.qrCode}
                  expiresAt={localState.qrExpiresAt}
                  countdown={countdown}
                  onRefresh={onReconnect}
                  isRefreshing={localState.isConnecting}
                  small
                />
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions + Menu */}
        {!isEditing && (
          <div className="flex items-center gap-2">
            {/* Quick action button based on status */}
            {connection.status === 'connected' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={localState.isDisconnecting}
                className="text-orange-600 border-orange-200 hover:bg-orange-50 hover:border-orange-300"
              >
                {localState.isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <PowerOff className="h-4 w-4 mr-1.5" />
                    Disconnect
                  </>
                )}
              </Button>
            ) : connection.status === 'disconnected' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                disabled={localState.isConnecting}
                className="text-whatsapp-teal-green border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300"
              >
                {localState.isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-1.5" />
                    Reconnect
                  </>
                )}
              </Button>
            ) : connection.status === 'pending' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={localState.isDisconnecting}
                className="text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
              >
                {localState.isDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <X className="h-4 w-4 mr-1.5" />
                    Cancel
                  </>
                )}
              </Button>
            ) : null}

            {/* 3-dot menu */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMenu(!showMenu)}
                className="h-8 w-8 p-0"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-dark-elevated border border-gray-200 dark:border-dark-border rounded-xl shadow-xl shadow-gray-200/50 dark:shadow-black/30 z-20 py-1.5 animate-fade-in">
                    <button
                      className="w-full px-3.5 py-2.5 text-left text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        onStartEdit()
                        setShowMenu(false)
                      }}
                    >
                      <Edit2 className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
                      Rename
                    </button>
                    {connection.status === 'connected' ? (
                      <button
                        className="w-full px-3.5 py-2.5 text-left text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 flex items-center gap-2.5 transition-colors"
                        onClick={() => {
                          onDisconnect()
                          setShowMenu(false)
                        }}
                        disabled={localState.isDisconnecting}
                      >
                        {localState.isDisconnecting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PowerOff className="h-4 w-4" />
                        )}
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className="w-full px-3.5 py-2.5 text-left text-sm text-whatsapp-teal-green hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center gap-2.5 transition-colors"
                        onClick={() => {
                          onReconnect()
                          setShowMenu(false)
                        }}
                        disabled={localState.isConnecting}
                      >
                        {localState.isConnecting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                        Reconnect
                      </button>
                    )}
                    <div className="my-1.5 border-t border-gray-100 dark:border-dark-border" />
                    <button
                      className="w-full px-3.5 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2.5 transition-colors"
                      onClick={() => {
                        if (window.confirm('Are you sure you want to delete this connection?')) {
                          onDelete()
                        }
                        setShowMenu(false)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// QR Code Display Component
function QRCodeDisplay({
  qrCode,
  expiresAt,
  countdown,
  onRefresh,
  isRefreshing,
  small = false,
}: {
  qrCode: string
  expiresAt: Date | null
  countdown?: number
  onRefresh: () => void
  isRefreshing: boolean
  small?: boolean
}) {
  const [localCountdown, setLocalCountdown] = useState<number>(0)

  // Calculate countdown if not provided
  useEffect(() => {
    if (countdown !== undefined) {
      setLocalCountdown(countdown)
      return
    }

    if (!expiresAt) {
      setLocalCountdown(0)
      return
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setLocalCountdown(remaining)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [expiresAt, countdown])

  const displayCountdown = countdown !== undefined ? countdown : localCountdown
  const size = small ? 128 : 200

  return (
    <div className="relative inline-block">
      <div
        className={cn(
          'p-2 bg-white border rounded-lg',
          small ? 'border-gray-200' : 'border-2 border-gray-200'
        )}
      >
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(qrCode)}`}
          alt="WhatsApp QR Code"
          className={small ? 'w-32 h-32' : 'w-48 h-48'}
        />
        {displayCountdown <= 30 && displayCountdown > 0 && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-orange-600 font-medium text-sm">Expiring</p>
              <p className="text-xl font-bold text-gray-900">{displayCountdown}s</p>
            </div>
          </div>
        )}
        {displayCountdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-red-600 font-medium text-sm mb-1">Expired</p>
              <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      {displayCountdown > 30 && (
        <p className="text-xs text-gray-400 text-center mt-1">
          Expires in {Math.floor(displayCountdown / 60)}:
          {String(displayCountdown % 60).padStart(2, '0')}
        </p>
      )}
    </div>
  )
}

// Empty state for connections list
function EmptyConnectionsView({ onAdd, isCreating }: { onAdd: () => void; isCreating: boolean }) {
  return (
    <div className="relative py-12 px-4 dark:bg-dark-elevated rounded-lg">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-32 h-32 bg-gradient-to-br from-whatsapp-teal-green/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-gradient-to-tl from-emerald-500/5 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative text-center">
        {/* Animated illustration */}
        <div className="relative w-28 h-28 mx-auto mb-6">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-whatsapp-teal-green/20 animate-[spin_20s_linear_infinite]" />

          {/* Inner gradient circle */}
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-whatsapp-teal-green/10 via-emerald-50 to-teal-50" />

          {/* Icon container */}
          <div className="absolute inset-4 rounded-full bg-gradient-to-br from-whatsapp-teal-green to-whatsapp-dark-green flex items-center justify-center shadow-xl shadow-emerald-500/20 animate-float">
            <MessageCircle className="h-10 w-10 text-white" />
          </div>

          {/* Floating accent dots */}
          <div className="absolute -top-1 left-1/2 w-2 h-2 rounded-full bg-whatsapp-teal-green/60 animate-pulse" />
          <div
            className="absolute top-1/4 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse"
            style={{ animationDelay: '0.5s' }}
          />
          <div
            className="absolute -bottom-1 left-1/3 w-1.5 h-1.5 rounded-full bg-teal-400/60 animate-pulse"
            style={{ animationDelay: '1s' }}
          />
        </div>

        {/* Content */}
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary mb-2 tracking-tight">
          No WhatsApp Connections Yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-8 max-w-xs mx-auto leading-relaxed">
          Connect your first WhatsApp device to start managing conversations with your team.
        </p>

        {/* CTA Button */}
        <Button
          onClick={onAdd}
          disabled={isCreating}
          size="lg"
          className="bg-gradient-to-r from-whatsapp-teal-green to-whatsapp-dark-green hover:from-whatsapp-dark-green hover:to-whatsapp-teal-green text-white shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-300 px-8"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Creating Connection...
            </>
          ) : (
            <>
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Connection
            </>
          )}
        </Button>

        {/* Helper text */}
        <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-4">
          You'll need your phone nearby to scan the QR code
        </p>
      </div>
    </div>
  )
}

// =====================
// Single Connection Panel (Legacy)
// =====================

function SingleConnectionPanel({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const {
    state,
    qrCode,
    qrExpiresAt,
    phoneNumber,
    error,
    lastSync,
    connect,
    disconnect,
    refresh,
    isConnecting,
    isDisconnecting,
    isLoading,
  } = useWhatsAppConnection()

  // Countdown for QR expiry
  const [countdown, setCountdown] = useState<number>(0)

  useEffect(() => {
    if (!qrExpiresAt) {
      setCountdown(0)
      return
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((qrExpiresAt.getTime() - Date.now()) / 1000))
      setCountdown(remaining)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [qrExpiresAt])

  if (isLoading) {
    return (
      <div className={cn('p-6', className)}>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-64 mx-auto" />
      </div>
    )
  }

  // Compact view for sidebar/header
  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <StatusIndicator state={state} />
        <span className="text-sm text-gray-600">
          {state === 'connected' ? phoneNumber || 'Connected' : getStateLabel(state)}
        </span>
        {state === 'disconnected' && (
          <Button size="sm" variant="outline" onClick={connect} disabled={isConnecting}>
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-white dark:bg-dark-elevated rounded-lg border border-gray-200 dark:border-dark-border p-6',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-whatsapp-teal-green/10 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-whatsapp-teal-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
              WhatsApp Connection
            </h2>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
              Link your WhatsApp Business account
            </p>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Content based on state */}
      {state === 'disconnected' && (
        <DisconnectedView onConnect={connect} isConnecting={isConnecting} />
      )}

      {(state === 'connecting' || state === 'waiting_qr') && <ConnectingView />}

      {state === 'scanning' && qrCode && (
        <LegacyQRCodeView
          qrCode={qrCode}
          countdown={countdown}
          onRefresh={connect}
          isRefreshing={isConnecting}
        />
      )}

      {state === 'connected' && (
        <ConnectedView
          phoneNumber={phoneNumber}
          lastSync={lastSync}
          onDisconnect={disconnect}
          onRefresh={refresh}
          isDisconnecting={isDisconnecting}
        />
      )}

      {state === 'error' && <ErrorView error={error} onRetry={connect} isRetrying={isConnecting} />}
    </div>
  )
}

// Helper components

function StatusIndicator({ state }: { state: WhatsAppConnectionState }) {
  const colors: Record<WhatsAppConnectionState, string> = {
    disconnected: 'bg-gray-400',
    connecting: 'bg-yellow-400 animate-pulse',
    waiting_qr: 'bg-yellow-400 animate-pulse',
    scanning: 'bg-blue-400 animate-pulse',
    connected: 'bg-green-500',
    error: 'bg-red-500',
  }

  return <div className={cn('w-2 h-2 rounded-full', colors[state])} />
}

function StatusBadge({ state }: { state: WhatsAppConnectionState }) {
  const variants: Record<
    WhatsAppConnectionState,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline'
      icon: React.ReactNode
      label: string
    }
  > = {
    disconnected: {
      variant: 'secondary',
      icon: <WifiOff className="h-3 w-3" />,
      label: 'Disconnected',
    },
    connecting: {
      variant: 'outline',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: 'Connecting',
    },
    waiting_qr: {
      variant: 'outline',
      icon: <QrCode className="h-3 w-3" />,
      label: 'Waiting for QR',
    },
    scanning: {
      variant: 'outline',
      icon: <QrCode className="h-3 w-3 animate-pulse" />,
      label: 'Scan QR Code',
    },
    connected: {
      variant: 'default',
      icon: <Wifi className="h-3 w-3" />,
      label: 'Connected',
    },
    error: {
      variant: 'destructive',
      icon: <XCircle className="h-3 w-3" />,
      label: 'Error',
    },
  }

  const { variant, icon, label } = variants[state]

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {label}
    </Badge>
  )
}

function getStateLabel(state: WhatsAppConnectionState): string {
  const labels: Record<WhatsAppConnectionState, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting...',
    waiting_qr: 'Waiting for QR...',
    scanning: 'Scan QR code',
    connected: 'Connected',
    error: 'Connection error',
  }
  return labels[state]
}

function DisconnectedView({
  onConnect,
  isConnecting,
}: {
  onConnect: () => void
  isConnecting: boolean
}) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-dark-tertiary flex items-center justify-center">
        <Smartphone className="h-10 w-10 text-gray-400 dark:text-dark-text-tertiary" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary mb-2">
        Connect WhatsApp
      </h3>
      <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-6 max-w-sm mx-auto">
        Link your WhatsApp Business account to start receiving and sending messages.
      </p>
      <Button
        onClick={onConnect}
        disabled={isConnecting}
        className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <QrCode className="h-4 w-4 mr-2" />
            Connect Device
          </>
        )}
      </Button>
    </div>
  )
}

function ConnectingView() {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-blue-500 dark:text-blue-400 animate-spin" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary mb-2">
        Initializing Connection
      </h3>
      <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
        Please wait while we prepare the QR code...
      </p>
    </div>
  )
}

function LegacyQRCodeView({
  qrCode,
  countdown,
  onRefresh,
  isRefreshing,
}: {
  qrCode: string
  countdown: number
  onRefresh: () => void
  isRefreshing: boolean
}) {
  return (
    <div className="text-center">
      {/* QR Code Container */}
      <div className="relative inline-block p-4 bg-white border-2 border-gray-200 rounded-xl mb-4">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
          alt="WhatsApp QR Code"
          className="w-64 h-64"
        />
        {countdown <= 30 && countdown > 0 && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-orange-600 font-medium">QR Expiring</p>
              <p className="text-2xl font-bold text-gray-900">{countdown}s</p>
            </div>
          </div>
        )}
        {countdown === 0 && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <p className="text-red-600 font-medium mb-2">QR Expired</p>
              <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="space-y-2 mb-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary">
          Scan with WhatsApp
        </h3>
        <ol className="text-sm text-gray-600 dark:text-dark-text-secondary text-left max-w-xs mx-auto space-y-1">
          <li>1. Open WhatsApp on your phone</li>
          <li>2. Tap Menu or Settings</li>
          <li>3. Select Linked Devices</li>
          <li>4. Tap Link a Device</li>
          <li>5. Point your phone at this screen</li>
        </ol>
      </div>

      {/* Timer */}
      {countdown > 30 && (
        <p className="text-sm text-gray-400 dark:text-dark-text-tertiary">
          QR code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
        </p>
      )}
    </div>
  )
}

function ConnectedView({
  phoneNumber,
  lastSync,
  onDisconnect,
  onRefresh,
  isDisconnecting,
}: {
  phoneNumber: string | null
  lastSync: Date | null
  onDisconnect: () => void
  onRefresh: () => void
  isDisconnecting: boolean
}) {
  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-green-500 dark:text-green-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary mb-1">
        WhatsApp Connected
      </h3>
      {phoneNumber && (
        <p className="text-xl font-semibold text-whatsapp-teal-green mb-2">{phoneNumber}</p>
      )}
      {lastSync && (
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-4">
          Last synced: {lastSync.toLocaleString()}
        </p>
      )}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh Status
        </Button>
        <Button variant="destructive" size="sm" onClick={onDisconnect} disabled={isDisconnecting}>
          {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
        </Button>
      </div>
    </div>
  )
}

function ErrorView({
  error,
  onRetry,
  isRetrying,
}: {
  error: string | null
  onRetry: () => void
  isRetrying: boolean
}) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
        <XCircle className="h-10 w-10 text-red-500 dark:text-red-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-dark-text-primary mb-2">
        Connection Failed
      </h3>
      <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-4 max-w-sm mx-auto">
        {error || 'Unable to connect to WhatsApp. Please try again.'}
      </p>
      <Button onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Retrying...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </>
        )}
      </Button>
    </div>
  )
}

export default WhatsAppConnectionPanel
