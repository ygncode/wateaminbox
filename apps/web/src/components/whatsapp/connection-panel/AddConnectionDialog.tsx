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
import { QRCodeDisplay } from "../QRCodeDisplay";
import { getConnectionSetupStage } from "./setup-state";
import type { AddConnectionDialogProps } from "./types";

interface ConnectionSetupDialogProps extends AddConnectionDialogProps {
  connection: ConnectionWithState | null;
  onReconnect: () => void;
}

/** Keeps naming and QR pairing in one resumable dialog. */
export function AddConnectionDialog({
  name,
  onNameChange,
  onSubmit,
  onCancel,
  isCreating,
  connection,
  onReconnect,
}: ConnectionSetupDialogProps) {
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
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl p-0 sm:w-full">
        <div className="border-b border-[#dce3de] bg-[#f8faf8] p-5 dark:border-dark-border dark:bg-white/[0.025] sm:p-6">
          <DialogHeader className="text-left">
            <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-[#dcefe7] text-[#087a5c] dark:bg-emerald-400/10 dark:text-emerald-300">
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
                ? "WhatsApp connected"
                : isLinking
                  ? "Link your WhatsApp device"
                  : "Add WhatsApp connection"}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {isConnected
                ? "The device is ready for this workspace inbox."
                : isLinking
                  ? "Keep this window open while you scan the code. It closes automatically once WhatsApp connects."
                  : "Give this device a recognizable name, then continue to the QR code."}
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
              <div>
                <label
                  htmlFor="connection-name"
                  className="block text-sm font-medium"
                >
                  Device name{" "}
                  <span className="font-normal text-[#829089]">(optional)</span>
                </label>
                <Input
                  id="connection-name"
                  autoFocus
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder="Support phone"
                  autoComplete="off"
                  maxLength={80}
                  className="mt-2"
                />
                <p className="mt-2 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
                  Use a team or location name so members know which number they
                  are working with.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-[#dce3de] bg-[#f8faf8] p-3.5 dark:border-white/[0.08] dark:bg-white/[0.025]">
                <QrCode
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#087a5c] dark:text-emerald-300"
                  aria-hidden="true"
                />
                <p className="text-xs leading-5 text-[#53645d] dark:text-[#a9bab4]">
                  WhatsApp will ask you to scan one secure QR code. One phone
                  number can only be linked once in this workspace.
                </p>
              </div>
            </div>

            <DialogFooter className="border-t border-[#dce3de] bg-[#fbfcfb] px-5 py-4 dark:border-dark-border dark:bg-white/[0.02] sm:px-6">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating}
                className="gap-2 bg-[#087a5c] text-white hover:bg-[#06674e] dark:bg-[#159b73] dark:hover:bg-[#20ad83]"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing…
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
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
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                    <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
                  </div>
                  <p className="mt-4 font-semibold">
                    {connection?.phoneNumber || connection?.name}
                  </p>
                  <p className="mt-1 text-sm text-[#65736d] dark:text-dark-text-secondary">
                    Connected and ready to receive conversations.
                  </p>
                </div>
              ) : qrCode ? (
                <div className="flex flex-col items-center">
                  <div className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-[#dce3de] dark:ring-white/10">
                    <QRCodeDisplay
                      qrCode={qrCode}
                      expiresAt={qrExpiresAt}
                      onRefresh={onReconnect}
                      isRefreshing={
                        connection?.localState.isConnecting ?? false
                      }
                    />
                  </div>
                  <ol className="mt-5 flex w-full flex-col overflow-hidden rounded-xl border border-[#dce3de] bg-[#f8faf8] dark:border-white/[0.08] dark:bg-white/[0.025] sm:flex-row">
                    {[
                      { title: "Open WhatsApp", detail: "On your phone" },
                      {
                        title: "Linked devices",
                        detail: "From Settings or Menu",
                      },
                      { title: "Scan this code", detail: "Tap Link a device" },
                    ].map((step, index, steps) => (
                      <li
                        key={step.title}
                        className="relative flex min-w-0 flex-1 items-center gap-3 border-b border-[#e2e8e3] px-3.5 py-3 last:border-b-0 dark:border-white/[0.07] sm:border-b-0 sm:border-r sm:last:border-r-0"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dcefe7] text-xs font-bold text-[#087a5c] dark:bg-emerald-400/10 dark:text-emerald-300">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-[#315348] dark:text-[#d6e2dd]">
                            {step.title}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-[#829089] dark:text-dark-text-tertiary">
                            {step.detail}
                          </span>
                        </span>
                        {index < steps.length - 1 && (
                          <span className="absolute -right-2 z-10 hidden h-4 w-4 place-items-center rounded-full border border-[#dce3de] bg-white text-[#829089] dark:border-white/10 dark:bg-dark-elevated sm:grid">
                            <ChevronRight className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : setupError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-400/20 dark:bg-red-400/[0.06]">
                  <p className="font-semibold text-red-800 dark:text-red-200">
                    {isDuplicatePhone
                      ? "This number is already linked"
                      : "Could not prepare the QR code"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">
                    {setupError}
                  </p>
                  {isDuplicatePhone ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancel}
                      className="mt-4"
                    >
                      Close
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onReconnect}
                      className="mt-4 gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Try again
                    </Button>
                  )}
                </div>
              ) : isPreparing ? (
                <div
                  className="flex flex-col items-center py-10 text-center"
                  role="status"
                >
                  <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-[#dcefe7] text-[#087a5c] dark:bg-emerald-400/10 dark:text-emerald-300">
                    <Smartphone className="h-7 w-7" aria-hidden="true" />
                    <Loader2 className="absolute -bottom-2 -right-2 h-6 w-6 animate-spin rounded-full bg-white p-1 dark:bg-dark-elevated" />
                  </div>
                  <p className="mt-5 font-semibold">
                    Preparing secure QR code…
                  </p>
                  <p className="mt-1 text-sm text-[#65736d] dark:text-dark-text-secondary">
                    This usually takes only a few seconds.
                  </p>
                </div>
              ) : null}
            </div>

            {!isConnected && (
              <DialogFooter className="border-t border-[#dce3de] bg-[#fbfcfb] px-5 py-4 dark:border-dark-border dark:bg-white/[0.02] sm:px-6">
                <p className="mr-auto self-center text-xs text-[#65736d] dark:text-dark-text-secondary">
                  You can close this and resume from the pending connection.
                </p>
                <Button variant="outline" onClick={onCancel}>
                  Finish later
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
