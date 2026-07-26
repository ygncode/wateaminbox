import {
  ChevronDown,
  ChevronUp,
  Inbox,
  MessageSquareText,
  Smartphone,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import React, { useState } from "react";
import { useRealtimeContext } from "../../contexts";

const numberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function TransferPath({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div className="relative grid grid-cols-[52px_1fr_52px] items-center gap-3 py-2">
      <div className="relative z-10 grid size-13 place-items-center rounded-2xl border border-gray-200 bg-white text-gray-700 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-dark-text-primary">
        <Smartphone className="size-5" strokeWidth={1.8} />
        <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-whatsapp-green dark:border-[#172229]" />
      </div>

      <div className="relative h-px overflow-visible bg-gray-200 dark:bg-white/10">
        <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-whatsapp-green/70 via-whatsapp-green/20 to-transparent" />
        {[0, 1, 2].map((packet) => (
          <motion.span
            // Packet motion makes the transfer direction legible without
            // pretending that an unknown total is a percentage.
            key={packet}
            className="absolute -top-1 size-2 rounded-full bg-whatsapp-green shadow-[0_0_12px_rgba(37,211,102,0.75)]"
            initial={{ left: "0%", opacity: 0 }}
            animate={
              reduceMotion
                ? { left: `${25 + packet * 25}%`, opacity: 0.8 }
                : {
                    left: ["0%", "100%"],
                    opacity: [0, 1, 1, 0],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 2.4,
                    delay: packet * 0.75,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
          />
        ))}
      </div>

      <motion.div
        className="relative z-10 grid size-13 place-items-center rounded-2xl bg-whatsapp-green text-[#062b1a] shadow-[0_12px_28px_rgba(37,211,102,0.22)]"
        animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Inbox className="size-5" strokeWidth={2} />
      </motion.div>
    </div>
  );
}

export const SyncingOverlay = React.memo(function SyncingOverlay() {
  const { syncingConnections } = useRealtimeContext();
  const [isExpanded, setIsExpanded] = useState(true);
  const reduceMotion = useReducedMotion() ?? false;

  const totals = Array.from(syncingConnections.values()).reduce(
    (result, sync) => ({
      conversations: result.conversations + sync.conversations,
      messages: result.messages + sync.messages,
    }),
    { conversations: 0, messages: 0 },
  );

  const connectionCount = syncingConnections.size;
  const hasProgress = totals.conversations > 0 || totals.messages > 0;
  const compactSummary = hasProgress
    ? `${numberFormatter.format(totals.conversations)} chats ready`
    : "Preparing history";

  return (
    <AnimatePresence>
      {connectionCount > 0 && (
        <motion.aside
          layout
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          role="status"
          aria-live="polite"
          aria-label={`WhatsApp history is syncing. ${totals.conversations} conversations and ${totals.messages} messages ready.`}
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-3 right-3 z-50 sm:left-auto sm:right-5 sm:w-[390px] lg:bottom-5"
        >
          <motion.div
            layout
            className="relative overflow-hidden rounded-[22px] border border-black/10 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.2),0_2px_10px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[#172229]/95 dark:shadow-[0_28px_80px_rgba(0,0,0,0.46)]"
          >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-whatsapp-green to-transparent" />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.055]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(17,27,33,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(17,27,33,.7) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            />

            <AnimatePresence initial={false} mode="wait">
              {isExpanded ? (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="relative p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="relative flex size-2.5">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-whatsapp-green opacity-50 motion-reduce:animate-none" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-whatsapp-green" />
                        </span>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-whatsapp-green-a11y-text dark:text-whatsapp-green">
                          History import live
                        </span>
                      </div>
                      <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-gray-950 dark:text-dark-text-primary">
                        Bringing your inbox up to date
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsExpanded(false)}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green dark:text-dark-text-secondary dark:hover:bg-white/10 dark:hover:text-white"
                      aria-label="Collapse sync status"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>

                  <TransferPath reduceMotion={reduceMotion} />

                  <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-50/80 dark:border-white/[0.08] dark:bg-black/10">
                    <div className="border-r border-gray-200/80 px-3.5 py-3 dark:border-white/[0.08]">
                      <motion.p
                        key={totals.conversations}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="font-mono text-xl font-semibold tabular-nums text-gray-950 dark:text-white"
                      >
                        {numberFormatter.format(totals.conversations)}
                      </motion.p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-dark-text-secondary">
                        Conversations
                      </p>
                    </div>
                    <div className="px-3.5 py-3">
                      <motion.p
                        key={totals.messages}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="font-mono text-xl font-semibold tabular-nums text-gray-950 dark:text-white"
                      >
                        {numberFormatter.format(totals.messages)}
                      </motion.p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-dark-text-secondary">
                        Messages
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-dark-text-secondary">
                    <MessageSquareText className="size-3.5 text-whatsapp-green-a11y-text dark:text-whatsapp-green" />
                    <span>
                      Your inbox stays available while history arrives.
                    </span>
                    {connectionCount > 1 && (
                      <span className="ml-auto font-mono text-[10px] uppercase tracking-wider">
                        {connectionCount} lines
                      </span>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="compact"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="relative flex items-center gap-3 p-2.5 pl-3"
                >
                  <div className="relative grid size-9 place-items-center rounded-xl bg-whatsapp-green/15 text-whatsapp-green-a11y-text dark:bg-whatsapp-green/15 dark:text-whatsapp-green">
                    <Inbox className="size-4" />
                    <motion.span
                      className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-whatsapp-green"
                      animate={
                        reduceMotion ? undefined : { opacity: [0.35, 1, 0.35] }
                      }
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-950 dark:text-dark-text-primary">
                      Syncing WhatsApp history
                    </p>
                    <p className="truncate font-mono text-[11px] text-gray-500 dark:text-dark-text-secondary">
                      {compactSummary}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    className="grid size-8 place-items-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green dark:text-dark-text-secondary dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label="Expand sync status"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
});
