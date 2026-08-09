import {
  getDateRange as getDateRangeHelper,
  toISOString,
} from "@wateaminbox/shared";
import {
  Archive,
  Download,
  FileJson,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { TagSearchInput } from "@/components/tags/TagSearchInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/ui";
import { useTags } from "@/hooks/useContact";
import {
  type ExportFormat,
  useExportContacts,
  useExportConversation,
  useExportMessages,
  useFullBackupExport,
} from "@/hooks/useExport";

const MAX_EXPORT_TAGS = 50;

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "contacts" | "messages" | "conversation" | "full-backup";
  contactId?: string;
  contactName?: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  type,
  contactId,
  contactName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">(
    "all",
  );
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const debouncedTagSearch = useDebounce(tagSearch.trim(), 250);
  const [hasCustomName, setHasCustomName] = useState(false);

  const { data: tags } = useTags({
    search: debouncedTagSearch || undefined,
    limit: 100,
  });
  const exportContacts = useExportContacts();
  const exportMessages = useExportMessages();
  const exportConversation = useExportConversation();
  const fullBackupExport = useFullBackupExport();

  const isLoading =
    exportContacts.isPending ||
    exportMessages.isPending ||
    exportConversation.isPending ||
    fullBackupExport.isPending;

  const getDateRange = () => {
    if (dateRange === "all") return {};
    const { start, end } = getDateRangeHelper(dateRange);
    return { startDate: toISOString(start), endDate: toISOString(end) };
  };

  const handleExport = async () => {
    try {
      if (type === "contacts") {
        await exportContacts.mutateAsync({
          format,
          filters: {
            tagIds: selectedTags.length > 0 ? selectedTags : undefined,
            hasCustomName: hasCustomName || undefined,
          },
        });
      } else if (type === "messages") {
        const dates = getDateRange();
        await exportMessages.mutateAsync({
          format,
          filters: {
            ...dates,
          },
        });
      } else if (type === "conversation" && contactId) {
        const dates = getDateRange();
        await exportConversation.mutateAsync({
          contactId,
          format,
          ...dates,
        });
      } else if (type === "full-backup") {
        const dates = getDateRange();
        await fullBackupExport.mutateAsync(dates);
      }
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : prev.length < MAX_EXPORT_TAGS
          ? [...prev, tagId]
          : prev,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === "full-backup" ? (
              <Archive className="h-5 w-5" />
            ) : (
              <Download className="h-5 w-5" />
            )}
            {type === "full-backup"
              ? "Full Backup"
              : `Export ${
                  type === "contacts"
                    ? "Contacts"
                    : type === "messages"
                      ? "Messages"
                      : `Conversation${contactName ? ` with ${contactName}` : ""}`
                }`}
          </DialogTitle>
          <DialogDescription>
            {type === "full-backup"
              ? "Download a complete backup of all your data as a ZIP file"
              : "Choose your export format and filters"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Full backup info */}
          {type === "full-backup" && (
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">Your backup will include:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All contacts (JSON and CSV)</li>
                <li>All messages (JSON and CSV)</li>
                <li>Backup summary with statistics</li>
                <li>README file with documentation</li>
              </ul>
            </div>
          )}

          {/* Format selection - only for non-full-backup */}
          {type !== "full-backup" && (
            <div className="space-y-2">
              <Label>Format</Label>
              <div className="flex gap-2">
                <Button
                  variant={format === "csv" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFormat("csv")}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  CSV
                </Button>
                <Button
                  variant={format === "json" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFormat("json")}
                >
                  <FileJson className="h-4 w-4 mr-2" />
                  JSON
                </Button>
              </div>
            </div>
          )}

          {/* Date range for messages/conversations/full-backup */}
          {(type === "messages" ||
            type === "conversation" ||
            type === "full-backup") && (
            <div className="space-y-2">
              <Label>Date Range</Label>
              <Select
                value={dateRange}
                onValueChange={(v) => setDateRange(v as typeof dateRange)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              {type === "conversation" && dateRange === "all" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Note: Exports are limited to 50,000 messages. Use date ranges
                  for very large conversations.
                </p>
              )}
            </div>
          )}

          {/* Contact filters */}
          {type === "contacts" && (
            <>
              {/* Has custom name filter */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hasCustomName"
                  checked={hasCustomName}
                  onCheckedChange={(checked) =>
                    setHasCustomName(checked === true)
                  }
                />
                <Label htmlFor="hasCustomName" className="text-sm font-normal">
                  Only contacts with custom names
                </Label>
              </div>

              {/* Tag filter */}
              <div className="space-y-2">
                <Label>Filter by Tags</Label>
                <TagSearchInput value={tagSearch} onChange={setTagSearch} />
                {tags && tags.length > 0 ? (
                  <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                    {tags.map((tag) => {
                      const isSelected = selectedTags.includes(tag.id);
                      const isDisabled =
                        !isSelected && selectedTags.length >= MAX_EXPORT_TAGS;
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          disabled={isDisabled}
                          title={
                            isDisabled
                              ? `You can select up to ${MAX_EXPORT_TAGS} tags`
                              : undefined
                          }
                          className={`rounded-full border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                            isSelected
                              ? "border-whatsapp-teal-green bg-whatsapp-teal-green text-white"
                              : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                          }`}
                          style={
                            isSelected
                              ? undefined
                              : tag.color
                                ? { borderColor: tag.color, color: tag.color }
                                : undefined
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-2 text-center text-xs text-gray-500 dark:text-dark-text-secondary">
                    {debouncedTagSearch
                      ? `No tags match “${debouncedTagSearch}”`
                      : "No tags available"}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isLoading}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {type === "full-backup" ? "Creating Backup…" : "Exporting…"}
              </>
            ) : (
              <>
                {type === "full-backup" ? (
                  <Archive className="h-4 w-4 mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {type === "full-backup" ? "Download Backup" : "Export"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExportDialog;
