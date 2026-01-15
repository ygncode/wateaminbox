import { AlertCircle, Loader2, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useQuickReplies } from "@/hooks/useQuickReplies";
import type { QuickReply } from "@/lib/api/types";
import type { QuickReplyFormData } from "@/lib/schemas/quick-reply";
import { QuickRepliesList } from "./QuickRepliesList";
import { QuickReplyForm } from "./QuickReplyForm";

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
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

  const openCreateDialog = () => {
    setEditingQuickReply(null);
    setServerError(null);
    setSuccess(false);
    setIsDialogOpen(true);
  };

  const openEditDialog = (qr: QuickReply) => {
    setEditingQuickReply(qr);
    setServerError(null);
    setSuccess(false);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingQuickReply(null);
    setServerError(null);
    setSuccess(false);
  };

  const handleSubmit = async (data: QuickReplyFormData) => {
    setServerError(null);

    try {
      if (editingQuickReply) {
        await update(editingQuickReply.id, {
          shortcut: data.shortcut.trim(),
          title: data.title.trim(),
          content: data.content.trim(),
        });
        closeDialog();
      } else {
        await create({
          shortcut: data.shortcut.trim(),
          title: data.title.trim(),
          content: data.content.trim(),
        });
        setSuccess(true);
        // Auto-close after showing success
        setTimeout(() => {
          closeDialog();
        }, 1000);
      }
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("already exists")) {
          setServerError(
            t(
              "quickReplies.errors.shortcutExists",
              "A quick reply with this shortcut already exists",
            ),
          );
        } else {
          setServerError(err.message);
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
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
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
      <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
        {t(
          "quickReplies.description",
          "Create predefined message templates for quick responses. Type / followed by the shortcut in the message composer to use them.",
        )}
      </p>

      {/* Search and Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-0 bottom-0 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
          </div>
          <Input
            type="text"
            placeholder={t(
              "quickReplies.searchPlaceholder",
              "Search quick replies…",
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
      <QuickRepliesList
        quickReplies={filteredQuickReplies}
        isLoading={isLoading}
        hasSearchQuery={!!searchQuery}
        onEdit={openEditDialog}
        onDelete={setDeleteConfirmId}
      />

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <QuickReplyForm
            key={editingQuickReply?.id ?? "create"}
            isEditing={!!editingQuickReply}
            defaultValues={
              editingQuickReply
                ? {
                    shortcut: editingQuickReply.shortcut,
                    title: editingQuickReply.title,
                    content: editingQuickReply.content,
                  }
                : undefined
            }
            serverError={serverError}
            success={success}
            isSubmitting={isCreating || isUpdating}
            onSubmit={handleSubmit}
            onClose={closeDialog}
          />
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
