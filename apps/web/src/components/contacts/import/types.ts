import type { ContactImportPreviewResponse, ContactImportResponse } from '../../../lib/api'

export type ImportStep = 'upload' | 'preview' | 'importing' | 'complete'

export interface ImportOptions {
  updateExisting: boolean
  createTags: boolean
}

export interface UploadStepProps {
  loading: boolean
  onFileSelect: (file: File) => void
}

export interface PreviewStepProps {
  preview: ContactImportPreviewResponse
  options: ImportOptions
  onOptionsChange: (options: ImportOptions) => void
}

export interface ImportingStepProps {}

export interface CompleteStepProps {
  result: ContactImportResponse
}
