import { Plus, Tag, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddContactTag,
  useCreateTag,
  useRemoveContactTag,
  useTags,
} from "@/hooks/useContact";
import { cn } from "@/lib/utils";
import type { ContactData } from "./types";

interface TagsSectionProps {
  contact: ContactData;
}

/**
 * Tags section - display and manage contact tags
 */
export function TagsSection({ contact }: TagsSectionProps) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const { data: allTags, isLoading: isLoadingTags } = useTags();
  const addTag = useAddContactTag();
  const removeTag = useRemoveContactTag();
  const createTag = useCreateTag();

  const contactTagIds = new Set(contact.tags.map((t) => t.id));
  const availableTags = allTags?.filter((t) => !contactTagIds.has(t.id)) || [];

  const handleAddTag = async (tagId: string) => {
    await addTag.mutateAsync({ contactId: contact.id, tagId });
    setShowTagPicker(false);
  };

  const handleRemoveTag = async (tagId: string) => {
    await removeTag.mutateAsync({ contactId: contact.id, tagId });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const newTag = await createTag.mutateAsync({ name: newTagName.trim() });
      setNewTagName("");
      setShowCreateTag(false);
      // Automatically add the newly created tag to the contact
      await addTag.mutateAsync({ contactId: contact.id, tagId: newTag.id });
      setShowTagPicker(false);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create tag";
      if (errorMessage.includes("already exists")) {
        toast.error("A tag with this name already exists");
      } else {
        toast.error(errorMessage);
      }
    }
  };

  return (
    <RightPanelSection title="Tags">
      <div className="flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <div className="flex-1">
          <div className="flex flex-wrap gap-2">
            {contact.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className={cn(
                  "group cursor-pointer pr-1",
                  tag.color && `bg-${tag.color}-100 text-${tag.color}-700`,
                )}
                style={
                  tag.color
                    ? { backgroundColor: `${tag.color}20`, color: tag.color }
                    : undefined
                }
              >
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  className="ml-1 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <button
              onClick={() => setShowTagPicker(!showTagPicker)}
              className="flex h-6 items-center gap-1 rounded-full border border-dashed border-gray-300 dark:border-dark-border px-2 text-xs text-gray-500 dark:text-dark-text-secondary hover:border-gray-400 hover:text-gray-600 dark:hover:border-dark-text-tertiary dark:hover:text-dark-text-primary"
            >
              <Plus className="h-3 w-3" />
              Add Tag
            </button>
          </div>

          {showTagPicker && (
            <div className="mt-2 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-2 shadow-sm">
              {isLoadingTags ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <>
                  {availableTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {availableTags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="outline"
                          className="cursor-pointer hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                          style={
                            tag.color
                              ? { borderColor: tag.color, color: tag.color }
                              : undefined
                          }
                          onClick={() => handleAddTag(tag.id)}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {showCreateTag ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        placeholder="Enter tag name…"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCreateTag();
                          } else if (e.key === "Escape") {
                            setShowCreateTag(false);
                            setNewTagName("");
                          }
                        }}
                        className="h-7 text-xs flex-1"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim() || createTag.isPending}
                        className="h-7 px-2 text-xs"
                      >
                        {createTag.isPending ? "…" : "Create"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowCreateTag(false);
                          setNewTagName("");
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCreateTag(true)}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Create new tag
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </RightPanelSection>
  );
}
