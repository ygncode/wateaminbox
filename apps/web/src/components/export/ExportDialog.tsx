import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@/components/ui";
import { Download, FileSpreadsheet, FileJson, Loader2 } from "lucide-react";
import {
  useExportContacts,
  useExportMessages,
  useExportConversation,
  ExportFormat,
} from "@/hooks/useExport";
import { useTags } from "@/hooks/useContact";

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "contacts" | "messages" | "conversation";
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
  const [hasCustomName, setHasCustomName] = useState(false);

  const { data: tags } = useTags();
  const exportContacts = useExportContacts();
  const exportMessages = useExportMessages();
  const exportConversation = useExportConversation();

  const isLoading =
    exportContacts.isPending ||
    exportMessages.isPending ||
    exportConversation.isPending;

  const getDateRange = () => {
    if (dateRange === "all") return {};
    const end = new Date();
    const start = new Date();
    if (dateRange === "7d") start.setDate(start.getDate() - 7);
    else if (dateRange === "30d") start.setDate(start.getDate() - 30);
    else start.setDate(start.getDate() - 90);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
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
        : [...prev, tagId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export{" "}
            {type === "contacts"
              ? "Contacts"
              : type === "messages"
                ? "Messages"
                : `Conversation${contactName ? ` with ${contactName}` : ""}`}
          </DialogTitle>
          <DialogDescription>
            Choose your export format and filters
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Format selection */}
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

          {/* Date range for messages/conversations */}
          {(type === "messages" || type === "conversation") && (
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
              {tags && tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Filter by Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          selectedTags.includes(tag.id)
                            ? "bg-whatsapp-teal-green text-white border-whatsapp-teal-green"
                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                        }`}
                        style={
                          selectedTags.includes(tag.id)
                            ? undefined
                            : tag.color
                              ? { borderColor: tag.color, color: tag.color }
                              : undefined
                        }
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExportDialog;
