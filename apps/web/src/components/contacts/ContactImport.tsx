import { AlertCircle, FileText, X } from 'lucide-react'
import { useState } from 'react'
import type { ContactImportPreviewResponse, ContactImportResponse } from '../../lib/api'
import { importContacts, previewContactImport } from '../../lib/api'
import { StepWizard, StepContent, type StepWizardStep } from '../ui'
import {
  UploadStep,
  PreviewStep,
  ImportingStep,
  CompleteStep,
  type ImportStep,
  type ImportOptions,
} from './import'

interface ContactImportProps {
  onImportComplete?: () => void
  onClose?: () => void
}

const WIZARD_STEPS: StepWizardStep[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'preview', label: 'Preview' },
  { id: 'importing', label: 'Import' },
  { id: 'complete', label: 'Done' },
]

export function ContactImport({ onImportComplete, onClose }: ContactImportProps) {
  const [step, setStep] = useState<ImportStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ContactImportPreviewResponse | null>(null)
  const [result, setResult] = useState<ContactImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<ImportOptions>({
    updateExisting: true,
    createTags: true,
  })

  const handleFileSelect = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }

    setFile(selectedFile)
    setError(null)
    setLoading(true)

    try {
      const previewData = await previewContactImport(selectedFile)
      setPreview(previewData)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview file')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!file) return

    setStep('importing')
    setLoading(true)
    setError(null)

    try {
      const importResult = await importContacts(file, options)
      setResult(importResult)
      setStep('complete')
      onImportComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setStep('upload')
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
  }

  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg dark:shadow-black/30 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-dark-border">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
          Import Contacts
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded text-gray-600 dark:text-dark-text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <StepWizard steps={WIZARD_STEPS} currentStep={step} showProgress={step !== 'upload'}>
          <StepContent stepId="upload" currentStep={step}>
            <UploadStep loading={loading} onFileSelect={handleFileSelect} />
          </StepContent>

          <StepContent stepId="preview" currentStep={step}>
            {preview && (
              <PreviewStep preview={preview} options={options} onOptionsChange={setOptions} />
            )}
          </StepContent>

          <StepContent stepId="importing" currentStep={step}>
            <ImportingStep />
          </StepContent>

          <StepContent stepId="complete" currentStep={step}>
            {result && <CompleteStep result={result} />}
          </StepContent>
        </StepWizard>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary">
        {step === 'upload' && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <FileText className="h-4 w-4" />
            Supported format: CSV
          </div>
        )}

        {step === 'preview' && (
          <button
            onClick={handleReset}
            className="text-gray-600 dark:text-dark-text-secondary hover:text-gray-800 dark:hover:text-dark-text-primary"
          >
            Choose different file
          </button>
        )}

        {step === 'complete' && (
          <button
            onClick={handleReset}
            className="text-gray-600 dark:text-dark-text-secondary hover:text-gray-800 dark:hover:text-dark-text-primary"
          >
            Import more
          </button>
        )}

        {step === 'importing' && <div />}

        <div className="flex gap-3">
          {onClose && step !== 'importing' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg"
            >
              {step === 'complete' ? 'Done' : 'Cancel'}
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleImport}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50"
            >
              Import {preview?.total} contacts
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
