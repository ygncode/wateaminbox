import { Loader2, MessageCircle, Plus, QrCode, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyConnectionsViewProps {
  onAdd: () => void;
  isCreating: boolean;
}

const setupSteps = [
  { icon: Smartphone, label: "Name the device" },
  { icon: QrCode, label: "Scan a QR code" },
  { icon: MessageCircle, label: "Start receiving chats" },
];

/** First-run state for workspaces without a WhatsApp device. */
export function EmptyConnectionsView({
  onAdd,
  isCreating,
}: EmptyConnectionsViewProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dce3de] bg-[#f8faf8] dark:border-white/[0.08] dark:bg-white/[0.025]">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#dcefe7] text-[#087a5c] dark:bg-emerald-400/10 dark:text-emerald-300">
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0b7a55] dark:text-emerald-300">
              No devices linked
            </p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-[#10211b] dark:text-dark-text-primary">
              Connect WhatsApp to your workspace
            </h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
              Link a phone once, then your team can manage its conversations
              together from the shared inbox.
            </p>
          </div>
        </div>

        <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="Setup steps">
          {setupSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.label}
                className="flex items-center gap-3 rounded-xl border border-[#e2e8e3] bg-white px-3 py-3 dark:border-white/[0.07] dark:bg-white/[0.035]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf1ed] text-[#315348] dark:bg-white/[0.06] dark:text-[#b8c9c2]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 text-xs font-semibold text-[#315348] dark:text-[#c9d8d2]">
                  <span className="mr-1 text-[#829089]">{index + 1}.</span>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#dce3de] bg-white px-5 py-4 dark:border-white/[0.08] dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
          Keep your phone nearby—you’ll scan a code in WhatsApp.
        </p>
        <Button
          onClick={onAdd}
          disabled={isCreating}
          className="shrink-0 gap-2 bg-[#087a5c] text-white hover:bg-[#06674e] dark:bg-[#159b73] dark:hover:bg-[#20ad83]"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add first connection
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
