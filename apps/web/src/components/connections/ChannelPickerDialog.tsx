import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ChannelProviderAvailability } from "@/lib/api/channel-accounts";
import { cn } from "@/lib/utils";
import {
  CHANNEL_CATALOG,
  type ChannelCatalogEntry,
  channelUnavailableReason,
} from "./channel-catalog";

interface ChannelPickerDialogProps {
  availability: ChannelProviderAvailability[] | undefined;
  isLoadingAvailability: boolean;
  /** Count of connected accounts per catalog key, shown on the tile. */
  connectedCounts: Record<string, number>;
  onSelect: (entry: ChannelCatalogEntry) => void;
  onCancel: () => void;
}

/**
 * The provider grid.
 *
 * Selection is the only thing this dialog does: each provider owns a
 * different connect flow (QR pairing, a bot token, an OAuth redirect), so the
 * picker hands the choice back rather than trying to host all of them.
 */
export function ChannelPickerDialog({
  availability,
  isLoadingAvailability,
  connectedCounts,
  onSelect,
  onCancel,
}: ChannelPickerDialogProps) {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return CHANNEL_CATALOG;
    return CHANNEL_CATALOG.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [query]);

  const reasonFor = (entry: ChannelCatalogEntry): string | null =>
    channelUnavailableReason(entry, availability, isLoadingAvailability);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-0 sm:w-full">
        <div className="border-b border-[#dce3de] bg-[#f8faf8] p-5 dark:border-dark-border dark:bg-white/[0.025] sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl">Add a connection</DialogTitle>
            <DialogDescription className="leading-6">
              Choose the account this workspace should receive messages from.
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829089]"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search channels"
              className="pl-9"
            />
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#65736d] dark:text-[#a9bab4]">
              No channel matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
              {entries.map((entry) => {
                const reason = reasonFor(entry);
                const connected = connectedCounts[entry.key] ?? 0;
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      disabled={Boolean(reason)}
                      onClick={() => onSelect(entry)}
                      title={reason ?? `Connect ${entry.name}`}
                      className={cn(
                        "group flex w-full flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition-colors",
                        reason
                          ? "cursor-not-allowed opacity-40"
                          : "hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:hover:bg-white/[0.06]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-14 w-14 place-items-center rounded-2xl shadow-sm",
                          entry.tileClassName,
                        )}
                      >
                        <entry.Mark className="h-8 w-8" />
                      </span>
                      <span className="text-xs font-medium leading-tight text-[#10211b] dark:text-[#eef8f3]">
                        {entry.name}
                      </span>
                      {connected > 0 && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          {connected} connected
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Why a provider is greyed out matters more than that it is. */}
          {entries.some((entry) => entry.implemented && reasonFor(entry)) && (
            <ul className="mt-5 space-y-1 border-t border-[#e6ece8] pt-4 text-xs text-[#65736d] dark:border-white/[0.08] dark:text-[#a9bab4]">
              {entries
                .filter((entry) => entry.implemented && reasonFor(entry))
                .map((entry) => (
                  <li key={entry.key}>
                    <span className="font-medium">{entry.name}:</span>{" "}
                    {reasonFor(entry)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
