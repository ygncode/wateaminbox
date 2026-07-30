import type {
  ContactImportPreviewResponse,
  ContactImportResponse,
  WhatsAppConnection,
} from "../../../lib/api";

export type ImportStep = "upload" | "preview" | "importing" | "complete";

export interface ImportOptions {
  updateExisting: boolean;
  createTags: boolean;
}

export interface UploadStepProps {
  loading: boolean;
  onFileSelect: (file: File) => void;
  /** Connected WhatsApp accounts imported contacts can be linked to */
  connections: WhatsAppConnection[];
  /** Explicit user choice; null until picked */
  selectedConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
}

export interface PreviewStepProps {
  preview: ContactImportPreviewResponse;
  options: ImportOptions;
  onOptionsChange: (options: ImportOptions) => void;
}

export interface ImportingStepProps {}

export interface CompleteStepProps {
  result: ContactImportResponse;
}
