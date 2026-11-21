import { Loader2, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppConnectionsList } from "@/hooks/whatsapp";
import type { WhatsAppConnection } from "@/lib/api/types";

export function useWhatsAppAccountScope() {
  const {
    data: connections = [],
    isLoading,
    isError,
  } = useWhatsAppConnectionsList();
  const availableConnections = useMemo(
    () => connections.filter((connection) => !connection.archivedAt),
    [connections],
  );
  const [connectionId, setConnectionId] = useState("");

  useEffect(() => {
    if (
      connectionId &&
      availableConnections.some((connection) => connection.id === connectionId)
    ) {
      return;
    }

    const preferred =
      availableConnections.find(
        (connection) => connection.status === "connected",
      ) ?? availableConnections[0];
    setConnectionId(preferred?.id ?? "");
  }, [availableConnections, connectionId]);

  return {
    connections: availableConnections,
    connectionId,
    setConnectionId,
    selectedConnection: availableConnections.find(
      (connection) => connection.id === connectionId,
    ),
    isLoading,
    isError,
  };
}

export function WhatsAppAccountScope({
  connections,
  connectionId,
  onConnectionChange,
  isLoading,
}: {
  connections: WhatsAppConnection[];
  connectionId: string;
  onConnectionChange: (connectionId: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  const selected = connections.find(
    (connection) => connection.id === connectionId,
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-subtle px-4 py-3.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-accent shadow-sm">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {t("connections.whatsappAccount", "WhatsApp account")}
          </p>
          <p className="truncate text-xs text-fg-muted">
            {t(
              "connections.accountScopeHint",
              "Labels and catalogs stay isolated to the selected number.",
            )}
          </p>
          {selected && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  selected.status === "connected" ? "bg-signal" : "bg-warning"
                }`}
              />
              {selected.status === "connected"
                ? t("connections.connected", "Connected")
                : t("connections.notConnected", "Not connected")}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-10 min-w-56 items-center justify-center rounded-xl border border-line bg-surface/80">
          <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />
        </div>
      ) : connections.length > 0 ? (
        <Select value={connectionId} onValueChange={onConnectionChange}>
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label={t("connections.whatsappAccount", "WhatsApp account")}
          >
            <SelectValue
              placeholder={t("connections.selectAccount", "Select an account")}
            >
              {selected && (
                <span className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap">
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={selected.name}
                  >
                    {selected.name}
                  </span>
                  {selected.phoneNumber && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {selected.phoneNumber}
                    </span>
                  )}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                <span className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap">
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={connection.name}
                  >
                    {connection.name}
                  </span>
                  {connection.phoneNumber && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {connection.phoneNumber}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {t("connections.connectFirst", "Connect a WhatsApp account first")}
        </div>
      )}
    </div>
  );
}
