import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmedToken = botToken.trim();
  const tokenLooksValid = BOT_TOKEN_PATTERN.test(trimmedToken);
  const showTokenError = touched && trimmedToken.length > 0 && !tokenLooksValid;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl p-0 sm:w-full">
        <div className="border-b border-line bg-subtle p-5 sm:p-6">
          <DialogHeader className="text-start">
            <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-brand-telegram text-white">
              {connectedName ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <TelegramMark className="h-6 w-6" />
              )}
            </div>
            <DialogTitle className="text-xl">
              {connectedName
                ? t("connections.telegram.connected")
                : t("connections.telegram.connectTitle")}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {connectedName
                ? t("connections.telegram.connectedBody", {
                    name: connectedName,
                  })
                : t("connections.telegram.connectHint")}
            </DialogDescription>
          </DialogHeader>
        </div>

        {connectedName ? (
          <DialogFooter className="gap-2 p-5 sm:p-6">
            <Button onClick={onCancel} className="bg-primary">
              {t("connections.telegram.done")}
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
                  className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
                >
                  {error}
                </p>
              )}

              <div>
                <label
                  htmlFor="telegram-bot-token"
                  className="block text-sm font-medium"
                >
                  {t("connections.telegram.botToken")}
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
                      ? "mt-1.5 text-xs text-danger"
                      : "mt-1.5 text-xs text-fg-muted"
                  }
                >
                  {showTokenError
                    ? t("connections.telegram.tokenInvalid")
                    : t("connections.telegram.tokenHint")}
                </p>
              </div>

              <div>
                <label
                  htmlFor="telegram-display-name"
                  className="block text-sm font-medium"
                >
                  {t("connections.telegram.name")}{" "}
                  <span className="font-normal text-fg-muted">
                    {t("connections.telegram.optional")}
                  </span>
                </label>
                <Input
                  id="telegram-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={t("connections.telegram.namePlaceholder")}
                  maxLength={100}
                  className="mt-1.5"
                />
              </div>

              {/* Stated before connecting, not after: a bot added to a group
                  with privacy mode on receives nothing, and the resulting
                  empty inbox looks like a product fault rather than a setting. */}
              <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-warning">
                <p className="font-semibold">
                  {t("connections.telegram.groupsTitle")}
                </p>
                <p className="mt-1">
                  <Trans
                    i18nKey="connections.telegram.groupsBody"
                    components={{
                      code: (
                        <code className="rounded bg-warning-soft/10 px-1 py-0.5 font-mono text-xs" />
                      ),
                      strong: <strong className="font-semibold" />,
                    }}
                  />
                </p>
                <p className="mt-1">{t("connections.telegram.groupsDirect")}</p>
              </div>

              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                {t("connections.telegram.openBotFather")}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>

            <DialogFooter className="gap-2 border-t border-line p-5 sm:p-6">
              <Button type="button" variant="outline" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isConnecting || !tokenLooksValid}
                className="bg-primary hover:bg-primary-hover"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("connections.telegram.connecting")}
                  </>
                ) : (
                  t("connections.telegram.connect")
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
