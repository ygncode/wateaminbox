import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Zap,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { QuickReply } from "@/lib/api";

/**
 * Quick Replies Manager Component
 * Allows users to create, edit, and delete quick reply templates
 */
export function QuickRepliesManager() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuickReply, setEditingQuickReply] = useState<QuickReply | null>(
    null,
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    quickReplies,
    isLoading,
    error,
    create,
    update,
    delete: deleteQuickReply,
    isCreating,
    isUpdating,
    isDeleting,
  } = useQuickReplies({ search: searchQuery || undefined });

  const filteredQuickReplies = searchQuery
    ? quickReplies.filter(
        (qr) =>
          qr.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) ||
          qr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          qr.content.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : quickReplies;

  const resetForm = () => {
    setShortcut("");
    setTitle("");
    setContent("");
    setFormError(null);
    setEditingQuickReply(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (qr: QuickReply) => {
    setEditingQuickReply(qr);
    setShortcut(qr.shortcut);
    setTitle(qr.title);
    setContent(qr.content);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const validateShortcut = (value: string): boolean => {
    return /^[a-zA-Z0-9_-]+$/.test(value);
  };

  const handleSubmit = async () => {
    setFormError(null);

    // Validation
    if (!shortcut.trim()) {
      setFormError(
        t("quickReplies.errors.shortcutRequired", "Shortcut is required"),
      );
      return;
    }

    if (!validateShortcut(shortcut)) {
      setFormError(
        t(
          "quickReplies.errors.shortcutInvalid",
          "Shortcut can only contain letters, numbers, underscores, and hyphens",
        ),
      );
      return;
    }

    if (!title.trim()) {
      setFormError(t("quickReplies.errors.titleRequired", "Title is required"));
      return;
    }

    if (!content.trim()) {
      setFormError(
        t("quickReplies.errors.contentRequired", "Content is required"),
      );
      return;
    }

    try {
      if (editingQuickReply) {
        await update(editingQuickReply.id, {
          shortcut: shortcut.trim(),
          title: title.trim(),
          content: content.trim(),
        });
      } else {
        await create({
          shortcut: shortcut.trim(),
          title: title.trim(),
          content: content.trim(),
        });
      }
      closeDialog();
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("already exists")) {
          setFormError(
            t(
              "quickReplies.errors.shortcutExists",
              "A quick reply with this shortcut already exists",
            ),
          );
        } else {
          setFormError(err.message);
        }
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuickReply(id);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete quick reply:", err);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>
          {t("quickReplies.errors.loadFailed", "Failed to load quick replies")}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-gray-600">
        {t(
          "quickReplies.description",
          "Create predefined message templates for quick responses. Type / followed by the shortcut in the message composer to use them.",
        )}
      </p>

      {/* Search and Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-0 bottom-0 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            type="text"
            placeholder={t(
              "quickReplies.searchPlaceholder",
              "Search quick replies...",
            )}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          onClick={openCreateDialog}
          className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
          data-testid="add-quick-reply-button"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">
            {t("quickReplies.addNew", "Add New")}
          </span>
        </Button>
      </div>

      {/* Quick Replies List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filteredQuickReplies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Zap className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">
            {searchQuery
              ? t("quickReplies.noResults", "No quick replies found")
              : t("quickReplies.empty", "No quick replies yet")}
          </p>
          <p className="text-sm mt-1">
            {searchQuery
              ? t(
                  "quickReplies.tryDifferentSearch",
                  "Try a different search term",
                )
              : t(
                  "quickReplies.createFirst",
                  "Create your first quick reply to get started",
                )}
          </p>
        </div>
      ) : (
        <div
          className="space-y-2 max-h-[400px] overflow-y-auto"
          data-testid="quick-replies-list"
        >
          {filteredQuickReplies.map((qr) => (
            <div
              key={qr.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors group"
              data-testid={`quick-reply-item-${qr.shortcut}`}
            >
              {/* Shortcut badge */}
              <div className="flex-shrink-0">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-gray-100 text-gray-700">
                  /{qr.shortcut}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{qr.title}</p>
                <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">
                  {qr.content}
                </p>
              </div>

              {/* Actions */}
              <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditDialog(qr)}
                  className="h-8 w-8 p-0"
                  data-testid={`edit-quick-reply-${qr.shortcut}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmId(qr.id)}
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                  data-testid={`delete-quick-reply-${qr.shortcut}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {editingQuickReply
                ? t("quickReplies.editTitle", "Edit Quick Reply")
                : t("quickReplies.createTitle", "Create Quick Reply")}
            </DialogTitle>
            <DialogDescription>
              {editingQuickReply
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

          <div className="space-y-4 py-4">
            {formError && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-md">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="shortcut"
                className="text-sm font-medium text-gray-700"
              >
                {t("quickReplies.shortcutLabel", "Shortcut")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  /
                </span>
                <Input
                  id="shortcut"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                  placeholder={t(
                    "quickReplies.shortcutPlaceholder",
                    "greeting",
                  )}
                  className="pl-7"
                  maxLength={50}
                  data-testid="quick-reply-shortcut-input"
                />
              </div>
              <p className="text-xs text-gray-500">
                {t(
                  "quickReplies.shortcutHelp",
                  "Letters, numbers, underscores, and hyphens only",
                )}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="title"
                className="text-sm font-medium text-gray-700"
              >
                {t("quickReplies.titleLabel", "Title")}
              </label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t(
                  "quickReplies.titlePlaceholder",
                  "Welcome Message",
                )}
                maxLength={255}
                data-testid="quick-reply-title-input"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="content"
                className="text-sm font-medium text-gray-700"
              >
                {t("quickReplies.contentLabel", "Message Content")}
              </label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t(
                  "quickReplies.contentPlaceholder",
                  "Hello! Thank you for reaching out. How can I help you today?",
                )}
                rows={4}
                data-testid="quick-reply-content-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isCreating || isUpdating}
              className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
              data-testid="save-quick-reply-button"
            >
              {(isCreating || isUpdating) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {editingQuickReply
                ? t("common.save", "Save")
                : t("common.create", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {t("quickReplies.deleteTitle", "Delete Quick Reply")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "quickReplies.deleteConfirmation",
                "Are you sure you want to delete this quick reply? This action cannot be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={isDeleting}
              className="gap-2"
              data-testid="confirm-delete-quick-reply"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("common.delete", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default QuickRepliesManager;
