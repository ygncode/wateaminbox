import {
  ArchiveRestore,
  Loader2,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { WhatsAppConnection } from "@/lib/api/types";

interface ArchivedConnectionCardProps {
  connection: WhatsAppConnection;
  onRelink: () => Promise<void>;
  onPurge: () => Promise<void>;
  isRelinking: boolean;
  isPurging: boolean;
}

export function ArchivedConnectionCard({
  connection,
  onRelink,
  onPurge,
  isRelinking,
  isPurging,
}: ArchivedConnectionCardProps) {
  const [purgeOpen, setPurgeOpen] = useState(false);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-stone-200/90 bg-stone-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.025]">
      <div className="absolute inset-y-0 left-0 w-1 bg-stone-300 transition-colors group-hover:bg-emerald-500 dark:bg-white/10" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 pl-1">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-stone-500 shadow-sm ring-1 ring-stone-200 dark:bg-white/[0.06] dark:text-stone-300 dark:ring-white/10">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                {connection.name}
              </p>
              <span className="rounded-full bg-stone-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-600 dark:bg-white/10 dark:text-stone-300">
                Archived
              </span>
            </div>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              {connection.phoneNumber ||
                "Identity retained for historical inbox"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-emerald-200 bg-white text-emerald-800 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-400/[0.06] dark:text-emerald-300"
            disabled={isRelinking || isPurging}
            onClick={() => void onRelink()}
          >
            {isRelinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArchiveRestore className="h-4 w-4" />
            )}
            Link again
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-stone-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            disabled={isRelinking || isPurging}
            onClick={() => setPurgeOpen(true)}
            aria-label={`Permanently delete ${connection.name}`}
            title="Permanently delete inbox data"
          >
            {isPurging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-stone-200/70 pt-3 text-xs text-stone-500 dark:border-white/[0.06] dark:text-stone-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Conversations, notes, and assignments are retained.
      </div>

      <ConfirmationDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={`Permanently delete ${connection.name}?`}
        description="This erases this account's conversations, messages, contacts, assignments, and notes. This cannot be undone."
        confirmText="Permanently delete data"
        isDestructive
        isLoading={isPurging}
        onConfirm={async () => {
          await onPurge();
          setPurgeOpen(false);
        }}
      />
    </div>
  );
}
