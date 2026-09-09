import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
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
import { TelegramMark } from "./channel-icons";

/** Mirrors the server's token shape so a typo fails before a network call. */
const BOT_TOKEN_PATTERN = /^\d{5,16}:[A-Za-z0-9_-]{30,128}$/;

interface TelegramConnectDialogProps {
  onSubmit: (input: { botToken: string; displayName?: string }) => void;
  onCancel: () => void;
  isConnecting: boolean;
  /** Server-side failure, already turned into a sentence. */
  error: string | null;
  connectedName: string | null;
}

export function TelegramConnectDialog({
  onSubmit,
  onCancel,
  isConnecting,
  error,
  connectedName,
}: TelegramConnectDialogProps) {
  const [botToken, setBotToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmedToken = botToken.trim();
  const tokenLooksValid = BOT_TOKEN_PATTERN.test(trimmedToken);
  const showTokenError = touched && trimmedToken.length > 0 && !tokenLooksValid;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-0 sm:w-full">
        <div className="border-b border-[#dce3de] bg-[#f8faf8] p-5 dark:border-dark-border dark:bg-white/[0.025] sm:p-6">
          <DialogHeader className="text-left">
            <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-[#2AABEE] text-white">
              {connectedName ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <TelegramMark className="h-6 w-6" />
              )}
            </div>
            <DialogTitle className="text-xl">
              {connectedName ? "Telegram connected" : "Connect a Telegram bot"}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {connectedName
                ? `${connectedName} is now delivering messages into this workspace inbox.`
                : "Create a bot with @BotFather, then paste the token it gives you. The token is encrypted and never shown again."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {connectedName ? (
          <DialogFooter className="gap-2 p-5 sm:p-6">
            <Button onClick={onCancel} className="bg-[#087a5c]">
              Done
            </Button>
          </DialogFooter>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (!tokenLooksValid) return;
              onSubmit({
                botToken: trimmedToken,
                displayName: displayName.trim() || undefined,
              });
            }}
          >
            <div className="space-y-5 p-5 sm:p-6">
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/[0.06] dark:text-red-300"
                >
                  {error}
                </p>
              )}

              <div>
                <label
                  htmlFor="telegram-bot-token"
                  className="block text-sm font-medium"
                >
                  Bot token
                </label>
                <Input
                  id="telegram-bot-token"
                  autoFocus
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="123456789:AAExampleTokenFromBotFather"
                  aria-invalid={showTokenError}
                  aria-describedby="telegram-bot-token-hint"
                  className="mt-1.5"
                />
                <p
                  id="telegram-bot-token-hint"
                  className={
                    showTokenError
                      ? "mt-1.5 text-xs text-red-600 dark:text-red-400"
                      : "mt-1.5 text-xs text-[#65736d] dark:text-[#a9bab4]"
                  }
                >
                  {showTokenError
                    ? "That does not look like a BotFather token."
                    : "Looks like 123456789 followed by a colon and a long secret."}
                </p>
              </div>

              <div>
                <label
                  htmlFor="telegram-display-name"
                  className="block text-sm font-medium"
                >
                  Name{" "}
                  <span className="font-normal text-[#829089]">(optional)</span>
                </label>
                <Input
                  id="telegram-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Support bot"
                  maxLength={100}
                  className="mt-1.5"
                />
              </div>

              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#087a5c] hover:underline dark:text-emerald-300"
              >
                Open @BotFather
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>

            <DialogFooter className="gap-2 border-t border-[#e6ece8] p-5 dark:border-white/[0.08] sm:p-6">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isConnecting || !tokenLooksValid}
                className="bg-[#087a5c] hover:bg-[#06674e]"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
