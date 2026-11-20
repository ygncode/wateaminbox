import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Link2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";
import { formatPhoneLikeText } from "@/lib/utils";
import { QRCodeDisplay } from "../QRCodeDisplay";
import { getConnectionSetupStage } from "./setup-state";
import type { AddConnectionDialogProps } from "./types";
import { useTranslation } from "react-i18next";

interface ConnectionSetupDialogProps extends AddConnectionDialogProps {
  errorContent?: ReactNode;
  connection: ConnectionWithState | null;
  onReconnect: () => void;
}

/** Keeps naming and QR pairing in one resumable dialog. */
export function AddConnectionDialog({
  errorContent,
  name,
  onNameChange,
  onSubmit,
  onCancel,
  isCreating,
  connection,
  onReconnect,
}: ConnectionSetupDialogProps) {
  const { t } = useTranslation();

  const setupStage = getConnectionSetupStage(connection);
  const isLinking = setupStage !== "details";
  const qrCode = connection?.localState.qrCode ?? null;
  const qrExpiresAt = connection?.localState.qrExpiresAt ?? null;
  const setupError = connection?.localState.error;
  const isDuplicatePhone = setupError
    ?.toLocaleLowerCase()
    .includes("already linked");
  const isConnected = setupStage === "connected";
  const isPreparing = setupStage === "preparing";

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-0 sm:w-full">
        <div className="border-b border-line bg-subtle p-5 sm:p-6">
          <DialogHeader className="text-start">
            <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              {isConnected ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : isLinking ? (
                <QrCode className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Link2 className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <DialogTitle className="text-xl">
              {isConnected
                ? t("connections.dialogConnected", "WhatsApp connected")
                : isLinking
                  ? t("connections.dialogLinking", "Link your WhatsApp device")
                  : t("connections.dialogAdd", "Add WhatsApp connection")}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {isConnected
                ? t(
                    "connections.dialogConnectedHint",
                    "The device is ready for this workspace inbox.",
                  )
                : isLinking
                  ? t(
                      "connections.dialogLinkingHint",
                      "Keep this window open while you scan the code. It closes automatically once WhatsApp connects.",
                    )
                  : t(
                      "connections.dialogAddHint",
                      "Give this device a recognizable name, then continue to the QR code.",
                    )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {!isLinking ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="space-y-5 p-5 sm:p-6">
              {errorContent}
              <div>
                <label
                  htmlFor="connection-name"
                  className="block text-sm font-medium"
                >
                  {t("connections.deviceName")}{" "}
                  <span className="font-normal text-fg-muted">
                    {t("connections.optional")}
                  </span>
                </label>
                <Input
                  id="connection-name"
                  autoFocus
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder={t(
                    "connections.namePlaceholder",
                    "Support phone",
                  )}
                  autoComplete="off"
                  maxLength={80}
                  className="mt-2"
                />
                <p className="mt-2 text-xs leading-5 text-fg-muted">
                  {t(
                    "connections.nameHint",
                    "Use a team or location name so members know which number they are working with.",
                  )}
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-line bg-subtle p-3.5">
                <QrCode
                  className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                  aria-hidden="true"
                />
                <p className="text-xs leading-5 text-fg-muted">
                  {t(
                    "connections.qrHint",
                    "WhatsApp will ask you to scan one secure QR code. One phone number can only be linked once in this workspace.",
                  )}
                </p>
              </div>
            </div>

            <DialogFooter className="border-t border-line bg-subtle px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" onClick={onCancel}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isCreating}
                className="gap-2 bg-primary text-on-primary hover:bg-primary-hover"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("connections.preparing", "Preparing…")}
                  </>
                ) : (
                  <>
                    {t("connections.continue", "Continue")}
                    <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <div className="p-5 sm:p-6">
              {isConnected ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-accent">
                    <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
                  </div>
                  <p className="mt-4 font-semibold">
                    {formatPhoneLikeText(
                      connection?.phoneNumber || connection?.name,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t(
                      "connections.readyToReceive",
                      "Connected and ready to receive conversations.",
                    )}
                  </p>
                </div>
              ) : qrCode ? (
                <div className="flex flex-col items-center">
                  <div className="rounded-2xl bg-surface p-2 shadow-sm ring-1 ring-line-strong">
                    <QRCodeDisplay
                      qrCode={qrCode}
                      expiresAt={qrExpiresAt}
                      onRefresh={onReconnect}
                      isRefreshing={
                        connection?.localState.isConnecting ?? false
                      }
                    />
                  </div>
                  <ol className="mt-5 flex w-full flex-col overflow-hidden rounded-xl border border-line bg-subtle sm:flex-row">
                    {[
                      {
                        titleKey: "connections.qrSteps.openTitle",
                        title: "Open WhatsApp",
                        detailKey: "connections.qrSteps.openDetail",
                        detail: "On your phone",
                      },
                      {
                        titleKey: "connections.qrSteps.linkedTitle",
                        title: "Linked devices",
                        detailKey: "connections.qrSteps.linkedDetail",
                        detail: "From Settings or Menu",
                      },
                      {
                        titleKey: "connections.qrSteps.scanTitle",
                        title: "Scan this code",
                        detailKey: "connections.qrSteps.scanDetail",
                        detail: "Tap Link a device",
                      },
                    ].map((step, index, steps) => (
                      <li
                        key={step.titleKey}
                        className="relative flex min-w-0 flex-1 items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0 sm:border-b-0 sm:border-e sm:last:border-e-0"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-accent">
                            {t(step.titleKey, step.title)}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-fg-muted">
                            {t(step.detailKey, step.detail)}
                          </span>
                        </span>
                        {index < steps.length - 1 && (
                          <span className="absolute -end-2 z-10 hidden h-4 w-4 place-items-center rounded-full border border-line bg-surface text-fg-muted sm:grid">
                            <ChevronRight className="h-2.5 w-2.5 rtl:-scale-x-100" />
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : setupError ? (
                <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
                  <p className="font-semibold text-danger">
                    {isDuplicatePhone
                      ? t("connections.duplicatePhone")
                      : t("connections.qrPrepareFailed")}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-danger">
                    {setupError}
                  </p>
                  {isDuplicatePhone ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancel}
                      className="mt-4"
                    >
                      {t("common.close")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onReconnect}
                      className="mt-4 gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t("connections.tryAgainShort", "Try again")}
                    </Button>
                  )}
                </div>
              ) : isPreparing ? (
                <div
                  className="flex flex-col items-center py-10 text-center"
                  role="status"
                >
                  <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft text-accent">
                    <Smartphone className="h-7 w-7" aria-hidden="true" />
                    <Loader2 className="absolute -bottom-2 -end-2 h-6 w-6 animate-spin rounded-full bg-surface p-1" />
                  </div>
                  <p className="mt-5 font-semibold">
                    {t("connections.preparingQr", "Preparing secure QR code…")}
                  </p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t(
                      "connections.preparingQrHint",
                      "This usually takes only a few seconds.",
                    )}
                  </p>
                </div>
              ) : null}
            </div>

            {!isConnected && (
              <DialogFooter className="border-t border-line bg-subtle px-5 py-4 sm:px-6">
                <p className="me-auto self-center text-xs text-fg-muted">
                  {t(
                    "connections.resumeLater",
                    "You can close this and resume from the pending connection.",
                  )}
                </p>
                <Button variant="outline" onClick={onCancel}>
                  {t("connections.finishLater", "Finish later")}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
