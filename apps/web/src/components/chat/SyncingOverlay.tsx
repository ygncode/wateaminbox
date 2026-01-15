import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useWebSocketContext } from '../../contexts/WebSocketProvider'

// Floating message bubble component
const FloatingBubble = ({ delay, size }: { delay: number; size: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = {
    sm: 'w-6 h-5',
    md: 'w-8 h-6',
    lg: 'w-10 h-7',
  }

  return (
    <motion.div
      className={`absolute ${sizeClasses[size]} rounded-lg bg-whatsapp-green/20 dark:bg-whatsapp-green/30 border border-whatsapp-green/30`}
      initial={{ y: 60, opacity: 0, scale: 0.5 }}
      animate={{
        y: [-20, -80],
        opacity: [0, 1, 1, 0],
        scale: [0.5, 1, 1, 0.8],
      }}
      transition={{
        duration: 2.5,
        delay,
        repeat: Infinity,
        ease: 'easeOut',
      }}
    >
      {/* Message lines */}
      <div className="p-1.5 space-y-1">
        <div className="h-0.5 w-full bg-whatsapp-green/40 rounded" />
        <div className="h-0.5 w-2/3 bg-whatsapp-green/30 rounded" />
      </div>
    </motion.div>
  )
}

export const SyncingOverlay = React.memo(function SyncingOverlay() {
  const { syncingConnections } = useWebSocketContext()
  const [isVisible, setIsVisible] = useState(false)

  const totalConversations = Array.from(syncingConnections.values()).reduce(
    (sum, s) => sum + s.conversations,
    0
  )

  useEffect(() => {
    if (syncingConnections.size > 0) {
      requestAnimationFrame(() => setIsVisible(true))
    } else {
      setIsVisible(false)
    }
  }, [syncingConnections.size])

  if (syncingConnections.size === 0) return null

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
        >
          {/* Background with radial gradient */}
          <div className="absolute inset-0 bg-white dark:bg-dark-primary">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(37,211,102,0.08)_0%,_transparent_70%)] dark:bg-[radial-gradient(circle_at_center,_rgba(37,211,102,0.12)_0%,_transparent_60%)]" />
          </div>

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="relative z-10 text-center"
          >
            {/* Animated sync visualization */}
            <div className="relative h-32 w-32 mx-auto mb-8">
              {/* Pulsing glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-whatsapp-green/30"
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.3, 0.6, 0.3],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Inner ring */}
              <div className="absolute inset-4 rounded-full border border-whatsapp-green/20 dark:border-whatsapp-green/30" />

              {/* Center icon container */}
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Floating bubbles */}
                <FloatingBubble delay={0} size="md" />
                <FloatingBubble delay={0.8} size="sm" />
                <FloatingBubble delay={1.6} size="lg" />
              </div>

              {/* Rotating arc */}
              <motion.svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 128 128"
                animate={{ rotate: 360 }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'linear',
                }}
              >
                <circle
                  cx="64"
                  cy="64"
                  r="60"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="60 320"
                  strokeLinecap="round"
                  className="text-whatsapp-green"
                />
              </motion.svg>
            </div>

            {/* Text content with staggered reveal */}
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-dark-text-primary mb-3"
            >
              Syncing messages
            </motion.h2>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mb-4"
            >
              {totalConversations > 0 ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-whatsapp-green/10 dark:bg-whatsapp-green/20">
                  <motion.span
                    key={totalConversations}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-lg font-medium text-whatsapp-green dark:text-whatsapp-green"
                  >
                    {totalConversations}
                  </motion.span>
                  <span className="text-gray-600 dark:text-dark-text-secondary">
                    conversation{totalConversations !== 1 ? 's' : ''} synced
                  </span>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-dark-text-secondary">
                  Preparing to sync your conversations
                </p>
              )}
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-sm text-gray-400 dark:text-dark-text-tertiary flex items-center justify-center gap-1.5"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Please keep this window open
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
