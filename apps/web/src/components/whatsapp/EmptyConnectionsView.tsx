import { Loader2, MessageCircle, Plus, QrCode, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface EmptyConnectionsViewProps {
  onAdd: () => void;
  isCreating: boolean;
}

const setupSteps = [
  {
    icon: Smartphone,
    labelKey: "connections.setup.pickChannel",
    label: "Pick a channel",
  },
  {
    icon: QrCode,
    labelKey: "connections.setup.authorize",
    label: "Scan a code or paste a token",
  },
  {
    icon: MessageCircle,
    labelKey: "connections.setup.startReceiving",
    label: "Start receiving chats",
  },
];

/** First-run state for a workspace with no connected account on any channel. */
export function EmptyConnectionsView({
  onAdd,
  isCreating,
}: EmptyConnectionsViewProps) {
  const { t } = useTranslation();

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-subtle">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">
              {t("connections.noDevices", "No accounts connected")}
            </p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-fg">
              {t(
                "connections.connectToWorkspace",
                "Connect a messaging account",
              )}
            </h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-fg-muted">
              {t(
                "connections.connectToWorkspaceHint",
                "Connect WhatsApp or a Telegram bot once, then your team can manage its conversations together from the shared inbox.",
              )}
            </p>
          </div>
        </div>

        <ol
          className="mt-6 grid gap-2 sm:grid-cols-3"
          aria-label={t("connections.setupSteps", "Setup steps")}
        >
          {setupSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.label}
                className="flex items-center gap-3 rounded-xl border border-line bg-subtle px-3 py-3"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-accent">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 text-xs font-semibold text-accent">
                  <span className="me-1 text-fg-muted">{index + 1}.</span>
                  {t(step.labelKey, step.label)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-fg-muted">
          {t(
            "connections.keepPhoneNearby",
            "Keep your phone nearby—you’ll scan a code in WhatsApp.",
          )}
        </p>
        <Button
          onClick={onAdd}
          disabled={isCreating}
          className="shrink-0 gap-2 bg-primary text-on-primary hover:bg-primary-hover"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("connections.preparing")}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("connections.addFirstConnection", "Add first connection")}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
