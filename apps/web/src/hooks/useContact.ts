/**
 * Contact hooks - re-exports from organized sub-hooks
 *
 * This file maintains backward compatibility by re-exporting all contact
 * hooks and types from the contact/ subdirectory. For new code, prefer
 * importing directly from the specific sub-hooks:
 *
 * @example
 * // Preferred - specific imports
 * import { useContact, useUpdateContact } from '@/hooks/contact/useContactDetails'
 * import { usePrivateNotes } from '@/hooks/contact/useContactPrivateNotes'
 *
 * // Backward compatible - barrel import
 * import { useContact, usePrivateNotes } from '@/hooks/useContact'
 */

// Re-export all hooks and types from sub-hooks for backward compatibility
export {
  // Contact details
  useContact,
  useUpdateContact,
  useCreateContact,
  type ContactDetail,
  type CreateContactInput,
  type CreateContactResponse,
  // Private notes
  usePrivateNotes,
  useUpdatePrivateNotes,
  useCreatePrivateNote,
  useUpdatePrivateNote,
  useDeletePrivateNote,
  type PrivateNote,
  // Shared notes
  useSharedNotes,
  useCreateSharedNote,
  useUpdateSharedNote,
  useDeleteSharedNote,
  type SharedNote,
  // Tags
  useAddContactTag,
  useRemoveContactTag,
  useTags,
  useCreateTag,
  type Tag,
  // Assignment
  useAssignContact,
  useUnassignContact,
  useAssignmentHistory,
  type AssignmentHistoryEntry,
} from "./contact";
