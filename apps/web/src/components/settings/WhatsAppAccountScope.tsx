import { Loader2, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppConnectionsList } from "@/hooks/whatsapp";
import type { WhatsAppConnection } from "@/lib/api/types";
import { useTranslation } from "react-i18next";

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
    <div className="flex flex-col gap-3 rounded-2xl border border-[#dce5df] bg-[linear-gradient(135deg,#f6faf7_0%,#eef6f1_100%)] px-4 py-3.5 shadow-[0_1px_0_rgba(16,33,27,0.03)] dark:border-white/[0.08] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(16,185,129,0.035))] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-700/10 bg-white text-[#087a5c] shadow-sm dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-emerald-300">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#17342a] dark:text-dark-text-primary">
            {t("connections.whatsappAccount", "WhatsApp account")}
          </p>
          <p className="truncate text-xs text-[#65776f] dark:text-dark-text-secondary">
            {t(
              "connections.accountScopeHint",
              "Labels and catalogs stay isolated to the selected number.",
            )}
          </p>
          {selected && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-[#517066] dark:text-dark-text-secondary">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  selected.status === "connected"
                    ? "bg-emerald-500"
                    : "bg-amber-500"
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
        <div className="flex h-10 min-w-56 items-center justify-center rounded-xl border border-[#d8e1dc] bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.04]">
          <Loader2 className="h-4 w-4 animate-spin text-[#6b7e75]" />
        </div>
      ) : connections.length > 0 ? (
        <Select value={connectionId} onValueChange={onConnectionChange}>
          <SelectTrigger
            className="h-10 w-full bg-white shadow-sm sm:w-64 dark:bg-white/[0.05]"
            aria-label={t("connections.whatsappAccount", "WhatsApp account")}
          >
            <SelectValue
              placeholder={t("connections.selectAccount", "Select an account")}
            />
          </SelectTrigger>
          <SelectContent>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                <span className="flex items-center gap-2">
                  <span>{connection.name}</span>
                  {connection.phoneNumber && (
                    <span className="text-muted-foreground">
                      {connection.phoneNumber}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          {t("connections.connectFirst", "Connect a WhatsApp account first")}
        </div>
      )}
    </div>
  );
}
