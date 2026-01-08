/**
 * Search Filters Component
 *
 * Expandable filter panel for message search with date range and message type options.
 */

import {
  ChevronDown,
  ChevronUp,
  FileText,
  Filter,
  Image,
  MapPin,
  MessageSquare,
  Music,
  Video,
} from "lucide-react";
import { Badge, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import type { DateRange, MessageType } from "./types";

interface SearchFiltersProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  selectedTypes: MessageType[];
  onTypesChange: (types: MessageType[]) => void;
  expanded: boolean;
  onToggle: () => void;
}

const messageTypes: {
  value: MessageType;
  label: string;
  icon: React.ReactElement;
}[] = [
  {
    value: "text",
    label: "Text",
    icon: <MessageSquare className="w-3 h-3" />,
  },
  { value: "image", label: "Images", icon: <Image className="w-3 h-3" /> },
  { value: "video", label: "Videos", icon: <Video className="w-3 h-3" /> },
  { value: "audio", label: "Audio", icon: <Music className="w-3 h-3" /> },
  {
    value: "document",
    label: "Documents",
    icon: <FileText className="w-3 h-3" />,
  },
  {
    value: "location",
    label: "Location",
    icon: <MapPin className="w-3 h-3" />,
  },
];

export function SearchFilters({
  dateRange,
  onDateRangeChange,
  selectedTypes,
  onTypesChange,
  expanded,
  onToggle,
}: SearchFiltersProps) {
  const toggleType = (type: MessageType) => {
    if (selectedTypes.includes(type)) {
      onTypesChange(selectedTypes.filter((t) => t !== type));
    } else {
      onTypesChange([...selectedTypes, type]);
    }
  };

  return (
    <div className="border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary">
      {/* Filter Toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {(dateRange !== "all" || selectedTypes.length > 0) && (
            <Badge variant="default" className="text-xs">
              {(dateRange !== "all" ? 1 : 0) +
                (selectedTypes.length > 0 ? 1 : 0)}
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Expanded Filters */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Date Range */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">Date Range</Label>
            <Select value={dateRange} onValueChange={onDateRangeChange}>
              <SelectTrigger className="h-8 text-sm">
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

          {/* Message Types */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">Message Types</Label>
            <div className="flex flex-wrap gap-1.5">
              {messageTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => toggleType(type.value)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                    selectedTypes.includes(type.value)
                      ? "bg-whatsapp-teal-green text-white border-whatsapp-teal-green"
                      : "bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary border-gray-300 dark:border-dark-border hover:border-gray-400 dark:hover:border-dark-text-tertiary"
                  }`}
                >
                  {type.icon}
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
