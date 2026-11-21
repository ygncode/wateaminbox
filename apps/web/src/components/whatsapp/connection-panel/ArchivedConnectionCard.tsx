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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  const [purgeOpen, setPurgeOpen] = useState(false);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line/90 bg-subtle/70 p-4">
      <div className="absolute inset-y-0 start-0 w-1 bg-fg-subtle transition-colors group-hover:bg-primary-hover" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 ps-1">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised text-fg-muted shadow-sm ring-1 ring-line-strong">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-fg">
                {connection.name}
              </p>
              <span className="rounded-full bg-muted-strong/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">
                {t("connections.archived")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">
              {connection.phoneNumber || t("connections.identityRetained")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-accent/30 bg-accent-soft text-accent hover:border-accent hover:bg-accent-soft"
            disabled={isRelinking || isPurging}
            onClick={() => void onRelink()}
          >
            {isRelinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArchiveRestore className="h-4 w-4" />
            )}
            {t("connections.linkAgain")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-fg-subtle hover:bg-danger-soft hover:text-danger"
            disabled={isRelinking || isPurging}
            onClick={() => setPurgeOpen(true)}
            aria-label={t("connections.permanentDeleteAria", {
              defaultValue: "Permanently delete {{name}}",
              name: connection.name,
            })}
            title={t(
              "connections.permanentDeleteTitle",
              "Permanently delete inbox data",
            )}
          >
            {isPurging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
        {t(
          "connections.dataRetained",
          "Conversations, notes, and assignments are retained.",
        )}
      </div>

      <ConfirmationDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={t("connections.permanentDeleteConfirmTitle", {
          defaultValue: "Permanently delete {{name}}?",
          name: connection.name,
        })}
        description={t(
          "connections.permanentDeleteDescription",
          "This erases this account's conversations, messages, contacts, assignments, and notes. This cannot be undone.",
        )}
        confirmText={t(
          "connections.permanentDeleteConfirm",
          "Permanently delete data",
        )}
        isDestructive
        isLoading={isPurging}
        onConfirm={async () => {
          try {
            await onPurge();
            setPurgeOpen(false);
          } catch {
            // The failure is reported as a toast by the purge mutation. Keep
            // the dialog open so a retry is one click away, and never let the
            // rejection escape into an unhandled promise.
          }
        }}
      />
    </div>
  );
}
