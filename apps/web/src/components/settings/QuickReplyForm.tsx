import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, MessageSquareText, Zap } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  quickReplySchema,
  type QuickReplyFormData,
} from "@/lib/schemas/quick-reply";

interface QuickReplyFormProps {
  isEditing: boolean;
  defaultValues?: Partial<QuickReplyFormData>;
  serverError: string | null;
  isSubmitting: boolean;
  onSubmit: (data: QuickReplyFormData) => void;
  onClose: () => void;
}

/**
 * Quick Reply Form Component
 * Form for creating or editing a quick reply template
 * Uses react-hook-form with Zod validation
 */
export function QuickReplyForm({
  isEditing,
  defaultValues,
  serverError,
  isSubmitting,
  onSubmit,
  onClose,
}: QuickReplyFormProps) {
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<QuickReplyFormData>({
    resolver: zodResolver(quickReplySchema),
    defaultValues: {
      shortcut: defaultValues?.shortcut ?? "",
      title: defaultValues?.title ?? "",
      content: defaultValues?.content ?? "",
    },
    mode: "onChange",
  });

  const shortcut = watch("shortcut");
  const title = watch("title");
  const content = watch("content");
  const hasPreview = Boolean(shortcut && title && content.trim());

  return (
    <>
      <DialogHeader className="pe-8 text-start">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-ring">
            <Zap className="size-5" fill="currentColor" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <DialogTitle className="text-xl tracking-[-0.02em]">
              {isEditing
                ? t("quickReplies.editTitle", "Edit quick reply")
                : t("quickReplies.createTitle", "Create quick reply")}
            </DialogTitle>
            <DialogDescription className="mt-1 leading-5">
              {isEditing
                ? t(
                    "quickReplies.editDescription",
                    "Update the shortcut or response your team can insert.",
                  )
                : t(
                    "quickReplies.createDescription",
                    "Save a response your team can insert while chatting.",
                  )}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-2">
        {/* Server error message */}
        {serverError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* Shortcut Input */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="shortcut" className="font-semibold">
                {t("quickReplies.shortcutLabel", "Shortcut")}{" "}
                <span className="text-danger" aria-hidden="true">
                  *
                </span>
              </Label>
              <span className="text-[11px] text-fg-subtle">
                {t("quickReplies.shortcutMicrocopy", "What teammates type")}
              </span>
            </div>
            <div className="relative">
              <span
                className="absolute inset-y-0 start-0 grid w-9 place-items-center border-e border-line font-mono text-base font-bold text-accent"
                aria-hidden="true"
              >
                /
              </span>
              <Input
                id="shortcut"
                {...register("shortcut", {
                  onChange: (e) => {
                    const value = e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_-]/g, "");
                    setValue("shortcut", value, { shouldValidate: true });
                  },
                })}
                placeholder={t("quickReplies.shortcutPlaceholder", "greeting")}
                className="h-11 rounded-xl ps-12 font-mono font-medium"
                maxLength={50}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                data-testid="quick-reply-shortcut-input"
                aria-describedby="shortcut-hint"
                aria-invalid={errors.shortcut ? "true" : "false"}
              />
            </div>
            {errors.shortcut ? (
              <p className="text-xs text-danger" role="alert">
                {errors.shortcut.message}
              </p>
            ) : (
              <p id="shortcut-hint" className="text-xs text-fg-subtle">
                {t(
                  "quickReplies.shortcutHelpCompact",
                  "Letters, numbers, _ and -",
                )}
              </p>
            )}
          </div>

          {/* Title Input */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="title" className="font-semibold">
                {t("quickReplies.titleLabel", "Internal title")}{" "}
                <span className="text-danger" aria-hidden="true">
                  *
                </span>
              </Label>
              <span className="text-[11px] text-fg-subtle">
                {t("quickReplies.titleMicrocopy", "Only your team sees this")}
              </span>
            </div>
            <Input
              id="title"
              {...register("title")}
              placeholder={t(
                "quickReplies.titlePlaceholder",
                "Welcome message",
              )}
              className="h-11 rounded-xl"
              maxLength={200}
              data-testid="quick-reply-title-input"
              aria-invalid={errors.title ? "true" : "false"}
            />
            {errors.title ? (
              <p className="text-xs text-danger" role="alert">
                {errors.title.message}
              </p>
            ) : (
              <p className="text-xs text-fg-subtle">
                {t(
                  "quickReplies.titleHelpCompact",
                  "Use a name that is easy to scan",
                )}
              </p>
            )}
          </div>
        </div>

        {/* Content Input */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="content" className="font-semibold">
              {t("quickReplies.contentLabel", "Response")}{" "}
              <span className="text-danger" aria-hidden="true">
                *
              </span>
            </Label>
            <span
              className="font-mono text-[11px] tabular-nums text-fg-subtle"
              aria-live="polite"
            >
              {content.length.toLocaleString()} / 5,000
            </span>
          </div>
          <Textarea
            id="content"
            {...register("content")}
            placeholder={t(
              "quickReplies.contentPlaceholder",
              "Hello! Thank you for reaching out. How can I help you today?",
            )}
            rows={5}
            maxLength={5000}
            className="min-h-32 rounded-xl px-3.5 py-3 leading-6"
            data-testid="quick-reply-content-input"
            aria-describedby="content-hint"
            aria-invalid={errors.content ? "true" : "false"}
          />
          {errors.content ? (
            <p className="text-xs text-danger" role="alert">
              {errors.content.message}
            </p>
          ) : (
            <p
              id="content-hint"
              className="flex items-center gap-1.5 text-xs text-fg-subtle"
            >
              <MessageSquareText className="size-3.5" aria-hidden="true" />
              {t(
                "quickReplies.contentHintCompact",
                "Inserted into the composer so it can be personalized before sending",
              )}
            </p>
          )}
        </div>

        {hasPreview && (
          <div className="overflow-hidden rounded-xl border border-line bg-muted">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-subtle/70 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-subtle">
                  {t("quickReplies.preview", "Composer preview")}
                </span>
                <span className="truncate text-xs font-medium text-fg-muted">
                  {title}
                </span>
              </div>
              <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
                /{shortcut}
              </span>
            </div>
            <div className="p-3">
              <div className="ms-auto max-w-[88%] rounded-lg rounded-se-sm bg-bubble-out px-3 py-2 shadow-sm">
                <p className="whitespace-pre-wrap break-words text-sm leading-5 text-fg">
                  {content}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-2xl border-t border-line bg-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="sm:min-w-24"
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !isValid}
            className="min-w-32 bg-primary text-on-primary shadow-sm hover:bg-primary-hover disabled:bg-muted-strong disabled:text-fg-subtle disabled:opacity-100"
            data-testid="save-quick-reply-button"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 size-4 animate-spin" />
                {isEditing
                  ? t("common.saving", "Saving…")
                  : t("common.creating", "Creating…")}
              </>
            ) : (
              <>
                <Zap className="me-2 size-4" />
                {isEditing
                  ? t("quickReplies.saveAction", "Save changes")
                  : t("quickReplies.createAction", "Create reply")}
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
