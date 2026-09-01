import { Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "../../contexts/auth-context";
import { useConnectedApps } from "../../hooks/useConnectedApps";
import type { ConnectedApp } from "../../lib/api/types";
import { Badge, Button, LoadingSpinner } from "../ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/**
 * A client_id is the URL of the client's metadata document. Showing the host is
 * the honest identifier when a client supplies no name: it is the part a user
 * can actually recognise, and the part an impostor cannot fake.
 */
function clientHost(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

export function ConnectedAppsSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { apps, isLoading, error, refetch, disconnect, isDisconnecting } =
    useConnectedApps();
  const [pendingDisconnect, setPendingDisconnect] =
    useState<ConnectedApp | null>(null);

  const confirmDisconnect = async () => {
    if (!pendingDisconnect) return;
    try {
      await disconnect(pendingDisconnect.grantId);
      toast.success(t("connectedApps.disconnected", "Disconnected"));
      setPendingDisconnect(null);
    } catch {
      toast.error(
        t("connectedApps.disconnectFailed", "Could not disconnect this app"),
      );
    }
  };

  return (
    <>
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Plug className="h-4 w-4" aria-hidden="true" />
            {t("connectedApps.title", "Connected AI apps")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t(
              "connectedApps.description",
              "AI clients you have authorized to use this workspace. They see only what you can see, and disconnecting takes effect immediately.",
            )}
          </p>
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          // Rendering the empty state on a failed request tells the user
          // nothing is connected when the truth is unknown - the one wrong
          // answer here, because it invites them to stop looking.
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm">
              {t(
                "connectedApps.loadFailed",
                "Could not load connected apps. They may still be connected.",
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => refetch()}
            >
              {t("common.retry", "Retry")}
            </Button>
          </div>
        ) : apps.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            {t(
              "connectedApps.empty",
              "Nothing connected yet. When you connect this workspace from an AI client, it will appear here.",
            )}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {apps.map((app) => (
              <li
                key={app.grantId}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {app.clientName ?? clientHost(app.clientId)}
                    </span>
                    {app.scopes.includes("write") ? (
                      <Badge variant="secondary">
                        {t("connectedApps.scopeWrite", "can send messages")}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("connectedApps.scopeRead", "read-only")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {/* The metadata host, so a name alone cannot impersonate. */}
                    <code>{clientHost(app.clientId)}</code>
                    {" · "}
                    {app.lastUsedAt
                      ? t("connectedApps.lastUsed", "Last used {{date}}", {
                          date: new Date(app.lastUsedAt).toLocaleString(),
                        })
                      : t("connectedApps.neverUsed", "Not used yet")}
                    {" · "}
                    {t("connectedApps.connected", "Connected {{date}}", {
                      date: new Date(app.createdAt).toLocaleDateString(),
                    })}
                    {/* Only for someone else's connector: an admin cutting a
                        teammate's access needs to know whose it is, and their
                        own rows do not need the label. */}
                    {app.ownerUserId !== user?.id && app.ownerName
                      ? ` · ${t("connectedApps.authorizedBy", "Authorized by {{name}}", { name: app.ownerName })}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  // Offering this when the server would refuse produces a
                  // button that always fails.
                  disabled={isDisconnecting || !app.canDisconnect}
                  onClick={() => setPendingDisconnect(app)}
                  aria-label={t("connectedApps.disconnectApp", {
                    defaultValue: "Disconnect {{name}}",
                    name: app.clientName ?? clientHost(app.clientId),
                  })}
                >
                  <Unplug className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Disconnecting cuts a live integration, so it is confirmed rather than
          done on a single click - unlike a token, the user did not create this
          in the app and may not recall what depends on it. */}
      <Dialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("connectedApps.confirmTitle", "Disconnect this app?")}
            </DialogTitle>
            <DialogDescription>
              {t("connectedApps.confirmBody", {
                defaultValue:
                  "{{name}} will lose access to this workspace immediately. Anything relying on it stops working until you connect it again.",
                name:
                  pendingDisconnect?.clientName ??
                  (pendingDisconnect
                    ? clientHost(pendingDisconnect.clientId)
                    : ""),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDisconnect(null)}
              disabled={isDisconnecting}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting
                ? t("connectedApps.disconnecting", "Disconnecting…")
                : t("connectedApps.disconnect", "Disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
