import {
  AlertCircle,
  Check,
  Hash,
  Loader2,
  MessageSquare,
  Tag,
  Zap,
} from "lucide-react";
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

interface QuickReplyFormProps {
  isEditing: boolean;
  shortcut: string;
  title: string;
  content: string;
  formError: string | null;
  success: boolean;
  isSubmitting: boolean;
  onShortcutChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * Quick Reply Form Component
 * Form for creating or editing a quick reply template
 */
export function QuickReplyForm({
  isEditing,
  shortcut,
  title,
  content,
  formError,
  success,
  isSubmitting,
  onShortcutChange,
  onTitleChange,
  onContentChange,
  onSubmit,
  onClose,
}: QuickReplyFormProps) {
  const { t } = useTranslation();

  // Success view
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-green-400/20 animate-ping" />
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-500/30">
            <Check className="h-8 w-8 text-white" />
          </div>
        </div>
        <p className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary mt-4">
          {t("quickReplies.created", "Quick Reply Created!")}
        </p>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
          {t("quickReplies.createdHint", "Type /{shortcut} to use it", {
            shortcut,
          })}
        </p>
        {/* Preview badge */}
        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-dark-tertiary text-sm font-mono text-gray-700 dark:text-dark-text-primary">
          <span className="text-whatsapp-teal-green">/</span>
          {shortcut}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header with gradient background */}
      <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white dark:from-emerald-900/20 dark:via-teal-900/10 dark:to-dark-elevated">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-whatsapp-teal-green/10 to-transparent rounded-full blur-2xl" />
        <DialogHeader className="relative">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-whatsapp-teal-green to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
                {isEditing
                  ? t("quickReplies.editTitle", "Edit Quick Reply")
                  : t("quickReplies.createTitle", "Create Quick Reply")}
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 dark:text-dark-text-secondary mt-0.5">
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
            </div>
          </div>
        </DialogHeader>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="px-6 pb-6 pt-2"
      >
        {/* Server error message */}
        {formError && (
          <div className="flex items-center gap-2.5 p-3 mb-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200/50 dark:border-red-800/50 rounded-lg">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
              <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
            </div>
            <span>{formError}</span>
          </div>
        )}

        <div className="space-y-5">
          {/* Shortcut Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="shortcut"
                className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary"
              >
                <Hash className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
                {t("quickReplies.shortcutLabel", "Shortcut")}
                <span className="text-red-500">*</span>
              </Label>
              <span className="text-xs text-gray-400 dark:text-dark-text-tertiary font-mono">
                {shortcut.length}/50
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-whatsapp-teal-green font-mono font-semibold text-lg">
                /
              </span>
              <Input
                id="shortcut"
                value={shortcut}
                onChange={(e) =>
                  onShortcutChange(
                    e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  )
                }
                placeholder={t("quickReplies.shortcutPlaceholder", "greeting")}
                className="pl-8 font-mono text-base h-11 bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
                maxLength={50}
                autoFocus
                data-testid="quick-reply-shortcut-input"
                aria-describedby="shortcut-hint"
              />
            </div>
            <p
              id="shortcut-hint"
              className="text-xs text-gray-500 dark:text-dark-text-tertiary"
            >
              {t(
                "quickReplies.shortcutHelp",
                "Letters, numbers, underscores, and hyphens only",
              )}
            </p>
          </div>

          {/* Title Input */}
          <div className="space-y-2">
            <Label
              htmlFor="title"
              className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary"
            >
              <Tag className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
              {t("quickReplies.titleLabel", "Title")}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={t(
                "quickReplies.titlePlaceholder",
                "Welcome Message",
              )}
              className="h-11 bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
              maxLength={255}
              data-testid="quick-reply-title-input"
            />
            <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
              {t(
                "quickReplies.titleHint",
                "A descriptive name to identify this quick reply",
              )}
            </p>
          </div>

          {/* Content Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="content"
                className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary"
              >
                <MessageSquare className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
                {t("quickReplies.contentLabel", "Message Content")}
                <span className="text-red-500">*</span>
              </Label>
              <span className="text-xs text-gray-400 dark:text-dark-text-tertiary font-mono">
                {content.length} chars
              </span>
            </div>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder={t(
                "quickReplies.contentPlaceholder",
                "Hello! Thank you for reaching out. How can I help you today?",
              )}
              rows={4}
              className="resize-none bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
              data-testid="quick-reply-content-input"
              aria-describedby="content-hint"
            />
            <p
              id="content-hint"
              className="text-xs text-gray-500 dark:text-dark-text-tertiary"
            >
              {t(
                "quickReplies.contentHint",
                "This message will be sent when you use this quick reply",
              )}
            </p>
          </div>

          {/* Live Preview */}
          {(shortcut || title || content) && (
            <div className="p-3 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-dark-tertiary dark:to-dark-secondary border border-gray-200/50 dark:border-dark-border">
              <p className="text-xs font-medium text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider mb-2">
                Preview
              </p>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-whatsapp-teal-green/10 text-whatsapp-teal-green border border-whatsapp-teal-green/20">
                    /{shortcut || "..."}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900 dark:text-dark-text-primary truncate">
                    {title || "Untitled"}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-dark-text-secondary line-clamp-2 mt-0.5">
                    {content || "No content yet..."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-6 mt-2 border-t border-gray-100 dark:border-dark-border">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4"
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            disabled={
              isSubmitting ||
              !shortcut.trim() ||
              !title.trim() ||
              !content.trim()
            }
            className="px-5 bg-gradient-to-r from-whatsapp-teal-green to-emerald-600 hover:from-emerald-600 hover:to-whatsapp-teal-green text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-300"
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
                {isEditing ? t("common.save", "Save") : t("common.create", "Create")}
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
