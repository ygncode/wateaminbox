/**
 * Contact-related hooks
 *
 * This barrel file exports all contact sub-hooks for organized imports.
 * The main useContact.ts re-exports from here for backward compatibility.
 */

// Contact details hooks
export {
  useContact,
  useUpdateContact,
  useCreateContact,
  type ContactDetail,
  type CreateContactInput,
  type CreateContactResponse,
} from "./useContactDetails";

// Private notes hooks
export {
  usePrivateNotes,
  useUpdatePrivateNotes,
  useCreatePrivateNote,
  useUpdatePrivateNote,
  useDeletePrivateNote,
  type PrivateNote,
} from "./useContactPrivateNotes";

// Shared notes hooks
export {
  useSharedNotes,
  useCreateSharedNote,
  useUpdateSharedNote,
  useDeleteSharedNote,
  type SharedNote,
} from "./useContactSharedNotes";

// Tags hooks
export {
  useAddContactTag,
  useRemoveContactTag,
  useTags,
  useCreateTag,
  type Tag,
} from "./useContactTags";

// Assignment hooks
export {
  useAssignContact,
  useUnassignContact,
  useAssignmentHistory,
  type AssignmentHistoryEntry,
} from "./useContactAssignment";
