// Error classes
export { ImportCriticalError, ImportValidationError } from "./errors.js";

// Types
export type {
  ContactImportResult,
  ContactImportRow,
  ImportSummary,
} from "./types.js";

// Parsing functions
export { generateImportTemplate, parseCSV } from "./parsing.js";

// Validation functions
export { mapToContactRow, normalizePhoneNumber } from "./validation.js";

// Processing functions
export {
  type ImportConnection,
  importContacts,
  resolveImportConnection,
} from "./processing.js";
