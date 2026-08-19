import { AlertCircle, FileText, X } from "lucide-react";
import { useState } from "react";
import type {
  ContactImportPreviewResponse,
  ContactImportResponse,
} from "../../lib/api";
import { importContacts, previewContactImport } from "../../lib/api";
import { useWhatsAppConnectionsList } from "../../hooks/whatsapp";
import {
  StepWizard,
  StepContent,
  type StepWizardStep,
} from "@/components/ui/step-wizard";
import {
  UploadStep,
  PreviewStep,
  ImportingStep,
  CompleteStep,
  type ImportStep,
  type ImportOptions,
} from "./import";
import { useTranslation } from "react-i18next";

interface ContactImportProps {
  onImportComplete?: () => void;
  onClose?: () => void;
}

const WIZARD_STEPS: StepWizardStep[] = [
  { id: "upload", labelKey: "contacts.steps.upload", label: "Upload" },
  { id: "preview", labelKey: "contacts.steps.preview", label: "Preview" },
  { id: "importing", labelKey: "contacts.steps.import", label: "Import" },
  { id: "complete", labelKey: "contacts.steps.done", label: "Done" },
];

export function ContactImport({
  onImportComplete,
  onClose,
}: ContactImportProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContactImportPreviewResponse | null>(
    null,
  );
  const [result, setResult] = useState<ContactImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ImportOptions>({
    updateExisting: true,
    createTags: true,
  });
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);

  // Imported contacts get linked to a WhatsApp account. Sole connected
  // account is used automatically; several require an explicit pick.
  const { data: connections = [] } = useWhatsAppConnectionsList();
  const connectedConnections = connections.filter(
    (connection) => connection.status === "connected" && !connection.archivedAt,
  );
  const effectiveConnectionId =
    connectedConnections.length === 1
      ? connectedConnections[0].id
      : connectedConnections.some(
            (connection) => connection.id === selectedConnectionId,
          )
        ? selectedConnectionId
        : null;

  const handleFileSelect = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".csv")) {
      setError(t("contacts.csvRequired", "Please upload a CSV file"));
      return;
    }
    if (!effectiveConnectionId) {
      setError(
        connectedConnections.length === 0
          ? t(
              "contacts.connectBeforeImport",
              "Connect a WhatsApp account before importing contacts",
            )
          : t(
              "contacts.chooseAccountForImport",
              "Choose which WhatsApp account the contacts belong to",
            ),
      );
      return;
    }

    setFile(selectedFile);
    setError(null);
    setLoading(true);

    try {
      const previewData = await previewContactImport(
        selectedFile,
        effectiveConnectionId,
      );
      setPreview(previewData);
      setStep("preview");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("contacts.previewFailed", "Failed to preview file"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file || !effectiveConnectionId) return;

    setStep("importing");
    setLoading(true);
    setError(null);

    try {
      const importResult = await importContacts(file, {
        ...options,
        connectionId: effectiveConnectionId,
      });
      setResult(importResult);
      setStep("complete");
      onImportComplete?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("contacts.importFailed", "Import failed"),
      );
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg dark:shadow-black/30 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-dark-border">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
          {t("contacts.importTitle", "Import Contacts")}
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

        <StepWizard
          steps={WIZARD_STEPS}
          currentStep={step}
          showProgress={step !== "upload"}
        >
          <StepContent stepId="upload" currentStep={step}>
            <UploadStep
              loading={loading}
              onFileSelect={handleFileSelect}
              connections={connectedConnections}
              selectedConnectionId={effectiveConnectionId}
              onSelectConnection={setSelectedConnectionId}
            />
          </StepContent>

          <StepContent stepId="preview" currentStep={step}>
            {preview && (
              <PreviewStep
                preview={preview}
                options={options}
                onOptionsChange={setOptions}
              />
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
        {step === "upload" && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <FileText className="h-4 w-4" />
            {t("contacts.supportedFormat", "Supported format: CSV")}
          </div>
        )}

        {step === "preview" && (
          <button
            onClick={handleReset}
            className="text-gray-600 dark:text-dark-text-secondary hover:text-gray-800 dark:hover:text-dark-text-primary"
          >
            {t("contacts.chooseDifferentFile", "Choose different file")}
          </button>
        )}

        {step === "complete" && (
          <button
            onClick={handleReset}
            className="text-gray-600 dark:text-dark-text-secondary hover:text-gray-800 dark:hover:text-dark-text-primary"
          >
            {t("contacts.importMore", "Import more")}
          </button>
        )}

        {step === "importing" && <div />}

        <div className="flex gap-3">
          {onClose && step !== "importing" && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg"
            >
              {step === "complete" ? "Done" : "Cancel"}
            </button>
          )}

          {step === "preview" && (
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
  );
}
