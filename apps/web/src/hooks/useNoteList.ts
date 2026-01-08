import { useState, useCallback } from "react";

export interface UseNoteListOptions {
  onSave?: (content: string) => Promise<void> | void;
}

export interface UseNoteListReturn {
  /** Whether the add form is visible */
  showAddForm: boolean;
  /** Set visibility of the add form */
  setShowAddForm: (show: boolean) => void;
  /** Content of the new note being typed */
  newContent: string;
  /** Set new content */
  setNewContent: (content: string) => void;
  /** Whether the notes list is expanded */
  isExpanded: boolean;
  /** Toggle expanded state */
  toggleExpanded: () => void;
  /** Handle saving the new note */
  handleSave: () => Promise<void>;
  /** Handle canceling the add form */
  handleCancel: () => void;
}

/**
 * Hook for managing note list state (add form, expand/collapse)
 * Used by both PrivateNotesList and SharedNotesList components
 */
export function useNoteList(
  options: UseNoteListOptions = {},
): UseNoteListReturn {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleSave = useCallback(async () => {
    if (newContent.trim() && options.onSave) {
      await options.onSave(newContent.trim());
      setNewContent("");
      setShowAddForm(false);
    }
  }, [newContent, options.onSave]);

  const handleCancel = useCallback(() => {
    setNewContent("");
    setShowAddForm(false);
  }, []);

  return {
    showAddForm,
    setShowAddForm,
    newContent,
    setNewContent,
    isExpanded,
    toggleExpanded,
    handleSave,
    handleCancel,
  };
}
