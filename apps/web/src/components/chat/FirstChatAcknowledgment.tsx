import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/api/client";

interface Notice {
  required: boolean;
  notice: string;
  noticeVersion: string;
  guidanceUrl: string;
}

/** A send attempt waits for a saved acknowledgment; cancel keeps the draft intact. */
export function useFirstChatAcknowledgment(contactId: string | undefined) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [action, setAction] = useState<"send" | "schedule">("send");
  const approved = useRef(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const resolveAttempt = useRef<((accepted: boolean) => void) | null>(null);
  const path = `/contacts/${encodeURIComponent(contactId ?? "")}/first-chat-acknowledgment`;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      resolveAttempt.current?.(false);
    };
  }, []);

  function finish(accepted: boolean) {
    approved.current = accepted;
    setNotice(null);
    setChecked(false);
    setPending(false);
    inFlight.current = false;
    resolveAttempt.current?.(accepted);
    resolveAttempt.current = null;
  }

  async function ensureAcknowledged(
    action: "send" | "schedule" = "send",
  ): Promise<boolean> {
    if (!contactId || inFlight.current) return false;
    if (approved.current) return true;
    inFlight.current = true;
    setPending(true);
    setAction(action);
    setError(false);
    try {
      const result = await fetchWithAuth<Notice>(path);
      if (!active.current) return false;
      if (!result.required) {
        finish(true);
        return true;
      }
      setChecked(false);
      setNotice(result);
      return await new Promise<boolean>((resolve) => {
        resolveAttempt.current = resolve;
      });
    } catch {
      if (active.current) {
        toast.error(
          t(
            "chat.firstChat.loadError",
            "Could not check messaging acknowledgment. Please try sending again.",
          ),
        );
        finish(false);
      }
      return false;
    }
  }

  async function accept() {
    if (!checked || !notice || saving) return;
    setSaving(true);
    setError(false);
    try {
      await fetchWithAuth(path, {
        method: "POST",
        body: JSON.stringify({
          checked: true,
          noticeVersion: notice.noticeVersion,
        }),
      });
      if (active.current) finish(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const dialog = notice ? (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !saving) finish(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>
            {t("chat.firstChat.title", "Start the conversation thoughtfully")}
          </DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed">
            {notice.notice}
          </DialogDescription>
        </DialogHeader>
        <a
          className="text-sm text-whatsapp-teal-green underline underline-offset-4"
          href={notice.guidanceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(
            "chat.firstChat.guidance",
            "Read WhatsApp’s responsible messaging guidance",
          )}
        </a>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-4 text-sm leading-relaxed dark:border-dark-border">
          <Checkbox
            className="mt-1"
            checked={checked}
            disabled={saving}
            onCheckedChange={(value) => setChecked(value === true)}
          />
          <span>
            {t(
              "chat.firstChat.checkbox",
              "I understand and will follow these messaging guidelines.",
            )}
          </span>
        </label>
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
          {t(
            "chat.firstChat.record",
            "Your acknowledgment will be saved for this contact with your user account and the time.",
          )}
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {t(
              "chat.firstChat.saveError",
              "Could not save your acknowledgment. Please try again.",
            )}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => finish(false)}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button disabled={!checked || saving} onClick={accept}>
            {saving
              ? t("common.saving", "Saving…")
              : action === "schedule"
                ? t("chat.firstChat.schedule", "Confirm and schedule")
                : t("chat.firstChat.continue", "Confirm and send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;
  return { ensureAcknowledged, pending, dialog };
}
