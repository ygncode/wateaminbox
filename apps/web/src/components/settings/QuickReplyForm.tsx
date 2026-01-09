import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2, Zap } from "lucide-react";
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
import { quickReplySchema, type QuickReplyFormData } from "@/lib/schemas";

interface QuickReplyFormProps {
  isEditing: boolean;
  defaultValues?: Partial<QuickReplyFormData>;
  serverError: string | null;
  success: boolean;
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
  success,
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

  // Success view - only for CREATE operations
  if (success && !isEditing) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-lg font-medium text-gray-900 dark:text-dark-text-primary">
          {t("quickReplies.created", "Quick Reply Created!")}
        </p>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
          {t("quickReplies.createdHint", "Type /{shortcut} to use it", {
            shortcut,
          })}
        </p>
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-whatsapp-teal-green" />
          {isEditing
            ? t("quickReplies.editTitle", "Edit Quick Reply")
            : t("quickReplies.createTitle", "Create Quick Reply")}
        </DialogTitle>
        <DialogDescription>
          {isEditing
            ? t(
                "quickReplies.editDescription",
                "Update the quick reply details below.",
              )
            : t(
                "quickReplies.createDescription",
                "Create a new quick reply template.",
              )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
        {/* Server error message */}
        {serverError && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Shortcut Input */}
        <div className="space-y-2">
          <Label htmlFor="shortcut">
            {t("quickReplies.shortcutLabel", "Shortcut")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-whatsapp-teal-green font-mono font-semibold">
              /
            </span>
            <Input
              id="shortcut"
              {...register("shortcut", {
                onChange: (e) => {
                  // Transform to lowercase and remove invalid characters
                  const value = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "");
                  setValue("shortcut", value, { shouldValidate: true });
                },
              })}
              placeholder={t("quickReplies.shortcutPlaceholder", "greeting")}
              className="pl-7 font-mono"
              maxLength={50}
              autoFocus
              data-testid="quick-reply-shortcut-input"
              aria-describedby="shortcut-hint"
              aria-invalid={errors.shortcut ? "true" : "false"}
            />
          </div>
          {errors.shortcut ? (
            <p className="text-xs text-red-500 dark:text-red-400" role="alert">
              {errors.shortcut.message}
            </p>
          ) : (
            <p
              id="shortcut-hint"
              className="text-xs text-gray-500 dark:text-dark-text-tertiary"
            >
              {t(
                "quickReplies.shortcutHelp",
                "Letters, numbers, underscores, and hyphens only",
              )}
            </p>
          )}
        </div>

        {/* Title Input */}
        <div className="space-y-2">
          <Label htmlFor="title">
            {t("quickReplies.titleLabel", "Title")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <Input
            id="title"
            {...register("title")}
            placeholder={t("quickReplies.titlePlaceholder", "Welcome Message")}
            maxLength={200}
            data-testid="quick-reply-title-input"
            aria-invalid={errors.title ? "true" : "false"}
          />
          {errors.title ? (
            <p className="text-xs text-red-500 dark:text-red-400" role="alert">
              {errors.title.message}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
              {t(
                "quickReplies.titleHint",
                "A descriptive name to identify this quick reply",
              )}
            </p>
          )}
        </div>

        {/* Content Input */}
        <div className="space-y-2">
          <Label htmlFor="content">
            {t("quickReplies.contentLabel", "Message Content")}{" "}
            <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="content"
            {...register("content")}
            placeholder={t(
              "quickReplies.contentPlaceholder",
              "Hello! Thank you for reaching out. How can I help you today?",
            )}
            rows={4}
            className="resize-none"
            data-testid="quick-reply-content-input"
            aria-describedby="content-hint"
            aria-invalid={errors.content ? "true" : "false"}
          />
          {errors.content ? (
            <p className="text-xs text-red-500 dark:text-red-400" role="alert">
              {errors.content.message}
            </p>
          ) : (
            <p
              id="content-hint"
              className="text-xs text-gray-500 dark:text-dark-text-tertiary"
            >
              {t(
                "quickReplies.contentHint",
                "This message will be sent when you use this quick reply",
              )}
            </p>
          )}
        </div>

        {/* Live Preview - only show when ALL fields have content */}
        {shortcut && title && content && (
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-dark-tertiary">
            <p className="text-xs font-medium text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider mb-2">
              Preview
            </p>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-whatsapp-teal-green/10 text-whatsapp-teal-green">
                  /{shortcut}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 dark:text-dark-text-primary truncate">
                  {title}
                </p>
                <p className="text-sm text-gray-500 dark:text-dark-text-secondary line-clamp-2 mt-0.5">
                  {content}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !isValid}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            data-testid="save-quick-reply-button"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEditing
                  ? t("common.saving", "Saving...")
                  : t("common.creating", "Creating...")}
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                {isEditing
                  ? t("common.save", "Save")
                  : t("common.create", "Create")}
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
