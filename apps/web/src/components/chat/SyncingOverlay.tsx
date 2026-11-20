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
import { useTranslation } from "react-i18next";

const numberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function TransferPath({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div className="relative grid grid-cols-[52px_1fr_52px] items-center gap-3 py-2">
      <div className="relative z-10 grid size-13 place-items-center rounded-2xl border border-line bg-raised text-fg shadow-sm">
        <Smartphone className="size-5" strokeWidth={1.8} />
        <span className="absolute -end-1 -top-1 size-3 rounded-full border-2 border-surface bg-signal" />
      </div>

      <div className="relative h-px overflow-visible bg-muted-strong">
        <div className="absolute inset-y-0 start-0 w-full bg-gradient-to-r from-accent/70 via-accent/20 to-transparent" />
        {[0, 1, 2].map((packet) => (
          <motion.span
            // Packet motion makes the transfer direction legible without
            // pretending that an unknown total is a percentage.
            key={packet}
            className="absolute -top-1 size-2 rounded-full bg-signal shadow-md"
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
        className="relative z-10 grid size-13 place-items-center rounded-2xl bg-signal text-accent shadow-lg"
        animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Inbox className="size-5" strokeWidth={2} />
      </motion.div>
    </div>
  );
}

export const SyncingOverlay = React.memo(function SyncingOverlay() {
  const { t } = useTranslation();

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
    ? t("chat.chatsReady", {
        count: totals.conversations,
        formattedCount: numberFormatter.format(totals.conversations),
      })
    : t("chat.preparingHistory", "Preparing history");

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
          aria-label={t("chat.syncingAria", {
            conversations: totals.conversations,
            messages: totals.messages,
          })}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] start-3 end-3 z-50 sm:start-auto sm:end-5 sm:w-[390px] lg:bottom-5"
        >
          <motion.div
            layout
            className="relative overflow-hidden rounded-[22px] border border-line/10 bg-overlay/95 shadow-lg backdrop-blur-xl"
          >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-signal to-transparent" />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.055]"
              style={{
                backgroundImage:
                  "linear-gradient(var(--line-strong) 1px, transparent 1px), linear-gradient(90deg, var(--line-strong) 1px, transparent 1px)",
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
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-50 motion-reduce:animate-none" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-signal" />
                        </span>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                          {t("chat.historyImportLive", "History import live")}
                        </span>
                      </div>
                      <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-fg">
                        {t(
                          "chat.bringingUpToDate",
                          "Bringing your inbox up to date",
                        )}
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsExpanded(false)}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t(
                        "chat.collapseSyncStatus",
                        "Collapse sync status",
                      )}
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </div>

                  <TransferPath reduceMotion={reduceMotion} />

                  <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line/80 bg-subtle/80">
                    <div className="border-e border-line/80 px-3.5 py-3">
                      <motion.p
                        key={totals.conversations}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="font-mono text-xl font-semibold tabular-nums text-fg"
                      >
                        {numberFormatter.format(totals.conversations)}
                      </motion.p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                        Conversations
                      </p>
                    </div>
                    <div className="px-3.5 py-3">
                      <motion.p
                        key={totals.messages}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="font-mono text-xl font-semibold tabular-nums text-fg"
                      >
                        {numberFormatter.format(totals.messages)}
                      </motion.p>
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                        Messages
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
                    <MessageSquareText className="size-3.5 text-accent" />
                    <span>
                      {t(
                        "chat.inboxAvailableDuringSync",
                        "Your inbox stays available while history arrives.",
                      )}
                    </span>
                    {connectionCount > 1 && (
                      <span className="ms-auto font-mono text-[10px] uppercase tracking-wider">
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
                  className="relative flex items-center gap-3 p-2.5 ps-3"
                >
                  <div className="relative grid size-9 place-items-center rounded-xl bg-accent/15 text-accent">
                    <Inbox className="size-4" />
                    <motion.span
                      className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-signal"
                      animate={
                        reduceMotion ? undefined : { opacity: [0.35, 1, 0.35] }
                      }
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {t("chat.syncingHistory", "Syncing WhatsApp history")}
                    </p>
                    <p className="truncate font-mono text-[11px] text-fg-muted">
                      {compactSummary}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    className="grid size-8 place-items-center rounded-full text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t(
                      "chat.expandSyncStatus",
                      "Expand sync status",
                    )}
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
