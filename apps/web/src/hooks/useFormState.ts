import { useState, useCallback } from "react";

/**
 * Options for the useFormState hook
 */
interface UseFormStateOptions<T> {
  /** Initial value for the form content */
  initialValue?: T;
  /** Callback when save is triggered */
  onSave?: (content: T) => void | Promise<void>;
  /** Callback when cancel is triggered */
  onCancel?: () => void;
  /** Reset content after save */
  resetOnSave?: boolean;
}

/**
 * Return type for the useFormState hook
 */
interface UseFormStateReturn<T> {
  /** Whether the form is in editing mode */
  isEditing: boolean;
  /** Current form content */
  content: T;
  /** Set the form content */
  setContent: (value: T | ((prev: T) => T)) => void;
  /** Start editing mode */
  startEdit: (initialValue?: T) => void;
  /** Save and exit editing mode */
  save: () => Promise<void>;
  /** Cancel and exit editing mode */
  cancel: () => void;
}

/**
 * Generic form state hook for add/edit patterns
 * Used by notes, tags, quick replies, and similar components
 *
 * @example
 * ```tsx
 * const { isEditing, content, setContent, startEdit, save, cancel } = useFormState({
 *   initialValue: '',
 *   onSave: async (content) => await addNote(content),
 *   resetOnSave: true,
 * })
 * ```
 */
export function useFormState<T = string>(
  options: UseFormStateOptions<T> = {},
): UseFormStateReturn<T> {
  const {
    initialValue = "" as unknown as T,
    onSave,
    onCancel,
    resetOnSave = true,
  } = options;

  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState<T>(initialValue);

  const startEdit = useCallback(
    (value?: T) => {
      setContent(value ?? initialValue);
      setIsEditing(true);
    },
    [initialValue],
  );

  const save = useCallback(async () => {
    if (onSave) {
      await onSave(content);
    }
    setIsEditing(false);
    if (resetOnSave) {
      setContent(initialValue);
    }
  }, [content, initialValue, onSave, resetOnSave]);

  const cancel = useCallback(() => {
    setIsEditing(false);
    setContent(initialValue);
    onCancel?.();
  }, [initialValue, onCancel]);

  return {
    isEditing,
    content,
    setContent,
    startEdit,
    save,
    cancel,
  };
}
