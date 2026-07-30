import {
  AlertCircle,
  Keyboard,
  Loader2,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { useDebounce } from "@/hooks/ui";
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
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), 250);

  const {
    quickReplies,
    total,
    isLoading,
    error,
    create,
    update,
    delete: deleteQuickReply,
    isCreating,
    isUpdating,
    isDeleting,
  } = useQuickReplies({ search: debouncedSearchQuery || undefined });

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
    setIsDialogOpen(true);
  };

  const openEditDialog = (qr: QuickReply) => {
    setEditingQuickReply(qr);
    setServerError(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingQuickReply(null);
    setServerError(null);
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
        toast.success(t("quickReplies.updated", "Quick reply updated"));
      } else {
        await create({
          shortcut: data.shortcut.trim(),
          title: data.title.trim(),
          content: data.content.trim(),
        });
        closeDialog();
        toast.success(t("quickReplies.created", "Quick reply created"));
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
      toast.success(t("quickReplies.deleted", "Quick reply deleted"));
    } catch (err) {
      console.error("Failed to delete quick reply:", err);
      toast.error(
        t("quickReplies.errors.deleteFailed", "Failed to delete quick reply"),
      );
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
      <div className="relative overflow-hidden rounded-2xl border border-[#cfe4da] bg-[#f3faf7] p-4 dark:border-emerald-400/15 dark:bg-emerald-400/[0.045]">
        <div
          className="absolute -right-6 -top-8 size-24 rounded-full bg-[#25d366]/10 blur-2xl"
          aria-hidden="true"
        />
        <div className="relative flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#008069] shadow-sm ring-1 ring-black/[0.045] dark:bg-white/[0.07] dark:text-emerald-300 dark:ring-white/[0.06]">
            <Zap className="size-5" fill="currentColor" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#263a43] dark:text-dark-text-primary">
              {t("quickReplies.calloutTitle", "Reply without breaking flow")}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-[#667781] dark:text-dark-text-secondary">
              {t(
                "quickReplies.calloutDescription",
                "In any conversation, type / and keep typing to find a saved response. Use the arrow keys and Enter to insert it.",
              )}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 font-mono text-xs font-semibold text-[#008069] ring-1 ring-black/[0.05] sm:flex dark:bg-white/[0.06] dark:text-emerald-300 dark:ring-white/[0.07]">
            <Keyboard className="size-3.5" aria-hidden="true" />
            /shortcut
          </span>
        </div>
      </div>

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
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchQuery("");
            }}
            className="pl-9 pr-9"
            aria-label={t(
              "quickReplies.searchPlaceholder",
              "Search quick replies…",
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-gray-400 transition-colors hover:bg-black/[0.05] hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:text-dark-text-tertiary dark:hover:bg-white/[0.06]"
              aria-label={t("quickReplies.clearSearch", "Clear search")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
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

      <div className="flex items-center justify-between gap-3 text-xs text-[#667781] dark:text-dark-text-secondary">
        <span aria-live="polite">
          {debouncedSearchQuery
            ? t("quickReplies.resultCount", "{{count}} matching replies", {
                count: total,
              })
            : t("quickReplies.totalCount", "{{count}} saved replies", {
                count: total,
              })}
        </span>
        <span className="hidden sm:inline">
          {t(
            "quickReplies.teamHint",
            "Available to everyone in this workspace",
          )}
        </span>
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
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-6 sm:max-w-xl">
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
            isSubmitting={isCreating || isUpdating}
            onSubmit={handleSubmit}
            onClose={closeDialog}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
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
