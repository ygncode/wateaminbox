import {
  CalendarClock,
  Clock3,
  Loader2,
  MessageCircleReply,
  MoonStar,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAutoReplySettings,
  useQuickReplySuggestions,
} from "@/hooks/useQuickReplies";
import type { AutoReplySendMode } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export function AutoReplySettingsCard() {
  const { t } = useTranslation();
  const { settings, isLoading, error, save, isSaving } = useAutoReplySettings();
  const { quickReplies, isLoading: repliesLoading } =
    useQuickReplySuggestions(true);
  const [enabled, setEnabled] = useState(false);
  const [quickReplyId, setQuickReplyId] = useState<string | null>(null);
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [sendMode, setSendMode] = useState<AutoReplySendMode>("always");

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setQuickReplyId(settings.quickReplyId);
    setDelayMinutes(settings.delayMinutes);
    setSendMode(settings.sendMode);
  }, [settings]);

  const hasChanges = Boolean(
    settings &&
      (enabled !== settings.enabled ||
        quickReplyId !== settings.quickReplyId ||
        delayMinutes !== settings.delayMinutes ||
        sendMode !== settings.sendMode),
  );
  const canSave =
    hasChanges &&
    (!enabled || Boolean(quickReplyId)) &&
    Number.isInteger(delayMinutes) &&
    delayMinutes >= 1 &&
    delayMinutes <= 1440;

  const handleSave = async () => {
    try {
      await save({ enabled, quickReplyId, delayMinutes, sendMode });
      toast.success(
        enabled
          ? t("quickReplies.autoReply.saved", "Automatic reply is active")
          : t("quickReplies.autoReply.disabled", "Automatic reply is off"),
      );
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : t("quickReplies.autoReply.saveFailed", "Could not save the rule"),
      );
    }
  };

  if (isLoading) {
    return (
      <div className="h-52 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-dark-border dark:bg-white/[0.025]" />
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/[0.06] dark:text-red-300">
        {t(
          "quickReplies.autoReply.loadFailed",
          "The automatic reply rule could not be loaded.",
        )}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cddbd5] bg-white shadow-[0_1px_2px_rgba(17,27,33,0.04)] dark:border-white/[0.09] dark:bg-white/[0.025]">
      <div className="flex flex-col gap-4 border-b border-[#dce5e1] bg-[linear-gradient(115deg,#f5fbf8_0%,#ffffff_62%)] p-5 sm:flex-row sm:items-start sm:justify-between dark:border-white/[0.07] dark:bg-[linear-gradient(115deg,rgba(16,185,129,0.07),rgba(255,255,255,0.015))]">
        <div className="flex gap-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#dff4eb] text-[#007a5e] ring-1 ring-[#bfe5d4] dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/15">
            <MessageCircleReply className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold tracking-[-0.01em] text-[#1f343d] dark:text-dark-text-primary">
                {t("quickReplies.autoReply.title", "First-contact reply")}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
                  enabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                    : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-dark-text-tertiary",
                )}
              >
                {enabled
                  ? t("quickReplies.autoReply.on", "On")
                  : t("quickReplies.autoReply.off", "Off")}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-[#667781] dark:text-dark-text-secondary">
              {t(
                "quickReplies.autoReply.description",
                "Welcome a new contact automatically if nobody on your team replies during the wait time.",
              )}
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 self-start rounded-full bg-white px-3 py-2 text-sm font-semibold text-[#344b54] shadow-sm ring-1 ring-black/[0.07] dark:bg-white/[0.06] dark:text-dark-text-primary dark:ring-white/[0.08]">
          <span>{t("quickReplies.autoReply.enable", "Enable")}</span>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={quickReplies.length === 0}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 cursor-pointer accent-[#008069] disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="auto-reply-template"
              className="text-sm font-semibold"
            >
              {t("quickReplies.autoReply.template", "Message template")}
            </Label>
            <Select
              value={quickReplyId ?? undefined}
              onValueChange={setQuickReplyId}
              disabled={repliesLoading || quickReplies.length === 0}
            >
              <SelectTrigger
                id="auto-reply-template"
                className="h-11 rounded-xl"
              >
                <SelectValue
                  placeholder={
                    repliesLoading
                      ? t("common.loading", "Loading…")
                      : t(
                          "quickReplies.autoReply.chooseTemplate",
                          "Choose a saved response",
                        )
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {quickReplies.map((reply) => (
                  <SelectItem key={reply.id} value={reply.id}>
                    {reply.title} · /{reply.shortcut}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {quickReplies.length === 0 && !repliesLoading && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t(
                  "quickReplies.autoReply.createTemplateFirst",
                  "Create a quick reply below before enabling this rule.",
                )}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-reply-delay" className="text-sm font-semibold">
              {t("quickReplies.autoReply.wait", "Wait before sending")}
            </Label>
            <div className="relative max-w-xs">
              <Clock3 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8696a0]" />
              <Input
                id="auto-reply-delay"
                type="number"
                min={1}
                max={1440}
                step={1}
                value={delayMinutes}
                onChange={(event) =>
                  setDelayMinutes(Number(event.target.value))
                }
                className="h-11 rounded-xl pl-9 pr-20"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[#667781]">
                {t("quickReplies.autoReply.minutes", "minutes")}
              </span>
            </div>
            <p className="text-xs text-[#667781] dark:text-dark-text-tertiary">
              {t(
                "quickReplies.autoReply.waitHint",
                "The reply is canceled if a teammate sends a message first.",
              )}
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">
            {t("quickReplies.autoReply.when", "When should it run?")}
          </legend>
          <ModeOption
            active={sendMode === "always"}
            icon={CalendarClock}
            title={t("quickReplies.autoReply.always", "Any time")}
            description={t(
              "quickReplies.autoReply.alwaysHint",
              "Use the rule for every brand-new direct contact.",
            )}
            onClick={() => setSendMode("always")}
          />
          <ModeOption
            active={sendMode === "outside_business_hours"}
            icon={MoonStar}
            title={t(
              "quickReplies.autoReply.afterHours",
              "Outside business hours",
            )}
            description={t("quickReplies.autoReply.afterHoursHint", {
              defaultValue: "Uses SLA business hours ({{timezone}}).",
              timezone: settings?.businessHoursTimezone ?? "UTC",
            })}
            onClick={() => setSendMode("outside_business_hours")}
          />
        </fieldset>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#e1e8e5] bg-[#f8faf9] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.07] dark:bg-white/[0.02]">
        <p className="flex items-center gap-2 text-xs text-[#667781] dark:text-dark-text-secondary">
          <ShieldCheck className="size-4 text-[#008069] dark:text-emerald-300" />
          {t(
            "quickReplies.autoReply.safety",
            "Direct chats only · once per contact · never during history sync",
          )}
        </p>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || isSaving}
          className="gap-2 bg-[#008069] text-white hover:bg-[#006f5b]"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t("quickReplies.autoReply.save", "Save rule")}
        </Button>
      </div>
    </section>
  );
}

function ModeOption({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof CalendarClock;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-[#7bc8af] bg-[#f0faf6] ring-1 ring-[#7bc8af]/30 dark:border-emerald-400/35 dark:bg-emerald-400/[0.07]"
          : "border-[#dce5e1] hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.035]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
          active
            ? "bg-white text-[#008069] shadow-sm dark:bg-white/[0.07] dark:text-emerald-300"
            : "bg-gray-100 text-gray-500 dark:bg-white/[0.05]",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-[#263a43] dark:text-dark-text-primary">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-[#667781] dark:text-dark-text-secondary">
          {description}
        </span>
      </span>
    </button>
  );
}
