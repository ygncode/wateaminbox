import { formatStatusTime } from "@wateaminbox/shared";
import {
  AlertCircle,
  Check,
  Clock,
  Link2,
  Loader2,
  RefreshCw,
  Tag,
  Unlink,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useWhatsAppAccountScope,
  WhatsAppAccountScope,
} from "@/components/settings/WhatsAppAccountScope";
import { TagSearchInput } from "@/components/tags/TagSearchInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/ui";
import { useTags } from "@/hooks/useContact";
import type { WhatsAppLabel } from "@/hooks/useLabels";
import { useLabels } from "@/hooks/useLabels";
import { cn } from "@/lib/utils";

/**
 * WhatsApp Labels Sync Manager Component
 * Allows users to sync WhatsApp Business labels with custom tags
 */
export function LabelSyncManager() {
  const { t } = useTranslation();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<WhatsAppLabel | null>(
    null,
  );
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [tagSearch, setTagSearch] = useState("");
  const debouncedTagSearch = useDebounce(tagSearch.trim(), 250);
  const [unlinkingLabelId, setUnlinkingLabelId] = useState<string | null>(null);
  const accountScope = useWhatsAppAccountScope();
  const { connectionId, selectedConnection } = accountScope;

  useEffect(() => {
    setLinkDialogOpen(false);
    setSelectedLabel(null);
    setSelectedTagId("");
    setTagSearch("");
  }, [connectionId]);

  const {
    labels,
    status,
    tagsWithStatus,
    isLoading,
    error,
    sync,
    link,
    unlink,
    autoCreateTags,
    isSyncing,
    isLinking,
    isUnlinking,
    isAutoCreating,
    loadMore,
    isLoadingMore,
    hasMore,
  } = useLabels(connectionId);

  const { data: tagsData } = useTags({
    search: debouncedTagSearch || undefined,
    limit: 100,
  });
  const allTags = tagsData || [];

  // Get unlinked tags for the select dropdown
  const unlinkedTags = allTags.filter(
    (tag) =>
      !tagsWithStatus.some(
        (t) => t.id === tag.id && t.whatsappLabelId !== null,
      ),
  );

  const handleSync = async () => {
    try {
      await sync();
      toast.success("Label sync started", {
        description: `Refreshing labels for ${selectedConnection?.name ?? "this account"}.`,
      });
    } catch (err) {
      toast.error("Could not sync labels", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleAutoCreate = async () => {
    try {
      await autoCreateTags();
      toast.success("Tags are ready", {
        description: "Unlinked WhatsApp labels were matched or created.",
      });
    } catch (err) {
      toast.error("Could not create tags", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const openLinkDialog = (label: WhatsAppLabel) => {
    setSelectedLabel(label);
    setSelectedTagId("");
    setTagSearch("");
    setLinkDialogOpen(true);
  };

  const handleLink = async () => {
    if (!selectedLabel || !selectedTagId) return;

    try {
      await link(selectedLabel.labelId, selectedTagId);
      setLinkDialogOpen(false);
      setSelectedLabel(null);
      setSelectedTagId("");
      toast.success("Tag linked");
    } catch (err) {
      toast.error("Could not link tag", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleUnlink = async (labelId: string) => {
    setUnlinkingLabelId(labelId);
    try {
      await unlink(labelId);
      toast.success("Tag unlinked");
    } catch (err) {
      toast.error("Could not unlink tag", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setUnlinkingLabelId(null);
    }
  };

  const formatLastSync = (dateString: string | null) => {
    if (!dateString) return t("labels.neverSynced", "Never synced");
    return formatStatusTime(dateString);
  };

  return (
    <div className="space-y-6">
      <WhatsAppAccountScope
        connections={accountScope.connections}
        connectionId={connectionId}
        onConnectionChange={accountScope.setConnectionId}
        isLoading={accountScope.isLoading}
      />

      {(error || accountScope.isError) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("labels.errors.loadFailed", "Failed to load labels")}</span>
        </div>
      )}

      {/* Status summary */}
      {status && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              value: status.totalLabels,
              label: t("labels.stats.whatsappLabels", "WhatsApp labels"),
            },
            {
              value: status.linkedLabels,
              label: t("labels.stats.linked", "Linked"),
              active: true,
            },
            {
              value: status.unlinkedLabels,
              label: t("labels.stats.unlinked", "Unlinked"),
            },
            {
              value: status.totalTags,
              label: t("labels.stats.customTags", "Workspace tags"),
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-[#e2e8e3] bg-[#f8faf8] p-3.5 dark:border-white/[0.07] dark:bg-white/[0.025]"
            >
              <dd
                className={cn(
                  "text-xl font-semibold tabular-nums text-[#10211b] dark:text-dark-text-primary",
                  item.active && "text-[#087a5c] dark:text-emerald-300",
                )}
              >
                {item.value}
              </dd>
              <dt className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
                {item.label}
              </dt>
            </div>
          ))}
        </dl>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleSync}
          disabled={
            isSyncing ||
            !connectionId ||
            selectedConnection?.status !== "connected"
          }
          variant="outline"
          className="gap-2"
          data-testid="sync-labels-button"
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("labels.syncFromWhatsApp", "Sync from WhatsApp")}
        </Button>

        {status && status.unlinkedLabels > 0 && (
          <Button
            onClick={handleAutoCreate}
            disabled={isAutoCreating || !connectionId}
            variant="outline"
            className="gap-2"
            data-testid="auto-create-tags-button"
          >
            {isAutoCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Tag className="h-4 w-4" />
            )}
            {t("labels.autoCreateTags", "Auto-create Tags")}
          </Button>
        )}

        {status?.lastSyncAt && (
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-dark-text-secondary ml-auto">
            <Clock className="h-3 w-3" />
            {formatLastSync(status.lastSyncAt)}
          </div>
        )}
      </div>

      {/* Labels List */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#e2e8e3] bg-[#f8faf8] py-10 dark:border-white/[0.07] dark:bg-white/[0.025]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
        </div>
      ) : labels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d6dfd9] bg-[#f8faf8] px-5 py-10 text-center text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.025] dark:text-dark-text-secondary">
          <Tag className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-dark-text-tertiary" />
          <p className="font-medium">
            {t("labels.empty", "No WhatsApp labels found")}
          </p>
          <p className="text-sm mt-1">
            {t(
              "labels.emptyHint",
              "Create labels in WhatsApp Business and click 'Sync from WhatsApp' to import them",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="labels-list">
          {labels.map((label) => {
            const linkedTag = tagsWithStatus.find(
              (t) => t.whatsappLabelId === label.labelId,
            );

            return (
              <div
                key={label.id}
                className="group flex items-center gap-3 rounded-xl border border-[#e2e8e3] bg-[#fbfcfb] p-3.5 transition-colors hover:border-[#c8d3cc] hover:bg-[#f8faf8] dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.04]"
                data-testid={`label-item-${label.labelId}`}
              >
                {/* Color indicator */}
                <div
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: label.color || "#6b7280",
                  }}
                />

                {/* Label name */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
                    {label.name}
                  </p>
                  {linkedTag ? (
                    <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-0.5">
                      <Check className="h-3 w-3" />
                      <span>
                        {t("labels.linkedTo", "Linked to")} "{linkedTag.name}"
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-dark-text-secondary mt-0.5">
                      {t("labels.notLinked", "Not linked to any tag")}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  {linkedTag ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnlink(label.labelId)}
                      disabled={isUnlinking}
                      className="gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-red-600 dark:hover:text-red-400"
                      data-testid={`unlink-label-${label.labelId}`}
                    >
                      {unlinkingLabelId === label.labelId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Unlink className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">
                        {t("labels.unlink", "Unlink")}
                      </span>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openLinkDialog(label)}
                      className="gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-green-600 dark:hover:text-green-400"
                      data-testid={`link-label-${label.labelId}`}
                    >
                      <Link2 className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {t("labels.link", "Link Tag")}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-3">
              <Button
                variant="outline"
                onClick={() => loadMore()}
                disabled={isLoadingMore}
                className="min-w-36 gap-2"
              >
                {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {isLoadingMore ? "Loading…" : "Load more labels"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Link Tag Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {t("labels.linkDialog.title", "Link Tag to Label")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "labels.linkDialog.description",
                "Select a tag to link with the WhatsApp label '{{labelName}}'.",
                { labelName: selectedLabel?.name },
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {selectedLabel && (
              <div className="flex items-center gap-2 mb-4 p-2 bg-gray-50 dark:bg-dark-tertiary rounded-lg">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{
                    backgroundColor: selectedLabel.color || "#6b7280",
                  }}
                />
                <span className="font-medium dark:text-dark-text-primary">
                  {selectedLabel.name}
                </span>
              </div>
            )}

            <TagSearchInput
              value={tagSearch}
              onChange={setTagSearch}
              className="mb-2"
            />
            <Select value={selectedTagId} onValueChange={setSelectedTagId}>
              <SelectTrigger data-testid="select-tag-trigger">
                <SelectValue
                  placeholder={t("labels.linkDialog.selectTag", "Select a tag")}
                />
              </SelectTrigger>
              <SelectContent>
                {unlinkedTags.length === 0 ? (
                  <div className="p-2 text-sm text-gray-500 dark:text-dark-text-secondary text-center">
                    {t(
                      "labels.linkDialog.noTags",
                      "No unlinked tags available",
                    )}
                  </div>
                ) : (
                  unlinkedTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: tag.color || "#6b7280",
                          }}
                        />
                        {tag.name}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <p className="text-xs text-gray-500 dark:text-dark-text-secondary mt-2">
              {t(
                "labels.linkDialog.hint",
                "When linked, applying this label in WhatsApp will also apply the tag in this app.",
              )}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleLink}
              disabled={isLinking || !selectedTagId}
              className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
              data-testid="confirm-link-button"
            >
              {isLinking && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("labels.link", "Link Tag")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LabelSyncManager;
