import { useState, useRef } from "react";
import {
  Upload,
  Download,
  FileText,
  Check,
  X,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  previewContactImport,
  importContacts,
  downloadImportTemplate,
  type ContactImportPreviewResponse,
  type ContactImportResponse,
} from "../../lib/api";

interface ContactImportProps {
  onImportComplete?: () => void;
  onClose?: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "complete";

export function ContactImport({
  onImportComplete,
  onClose,
}: ContactImportProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContactImportPreviewResponse | null>(
    null,
  );
  const [result, setResult] = useState<ContactImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [createTags, setCreateTags] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setLoading(true);

    try {
      const previewData = await previewContactImport(selectedFile);
      setPreview(previewData);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview file");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".csv")) {
      handleFileSelect(droppedFile);
    } else {
      setError("Please upload a CSV file");
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setStep("importing");
    setLoading(true);
    setError(null);

    try {
      const importResult = await importContacts(file, {
        updateExisting,
        createTags,
      });
      setResult(importResult);
      setStep("complete");
      onImportComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
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
    <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">Import Contacts</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-6">
            {/* Upload area */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0];
                  if (selectedFile) handleFileSelect(selectedFile);
                }}
              />
              {loading ? (
                <Loader2 className="h-12 w-12 mx-auto text-blue-500 animate-spin" />
              ) : (
                <Upload className="h-12 w-12 mx-auto text-gray-400" />
              )}
              <p className="mt-4 text-lg font-medium text-gray-700">
                Drop your CSV file here
              </p>
              <p className="mt-1 text-sm text-gray-500">or click to browse</p>
            </div>

            {/* Download template */}
            <div className="flex items-center justify-center">
              <button
                onClick={() => downloadImportTemplate()}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                <Download className="h-4 w-4" />
                Download CSV template
              </button>
            </div>

            {/* Instructions */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-medium mb-2">CSV Format</h3>
              <p className="text-sm text-gray-600 mb-3">
                Your CSV file should include a header row with these columns:
              </p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>
                  <strong>phone_number</strong> (required) - Phone number with
                  country code
                </li>
                <li>
                  <strong>name</strong> - Contact display name
                </li>
                <li>
                  <strong>notes</strong> - Shared notes about the contact
                </li>
                <li>
                  <strong>tags</strong> - Comma-separated tag names
                </li>
              </ul>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {preview.total}
                </div>
                <div className="text-sm text-blue-600">Total contacts</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {preview.newCount}
                </div>
                <div className="text-sm text-green-600">New contacts</div>
              </div>
              <div className="bg-yellow-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {preview.existingCount}
                </div>
                <div className="text-sm text-yellow-600">Already exist</div>
              </div>
            </div>

            {/* Options */}
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm">
                  Update existing contacts with new data
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={createTags}
                  onChange={(e) => setCreateTags(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm">
                  Create new tags if they don't exist
                </span>
              </label>
            </div>

            {/* Preview table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      #
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Phone
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Name
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.preview.slice(0, 10).map((row) => (
                    <tr key={row.row} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500">{row.row}</td>
                      <td className="px-4 py-2">{row.phoneNumber}</td>
                      <td className="px-4 py-2">{row.name || "-"}</td>
                      <td className="px-4 py-2">
                        {row.exists ? (
                          <span className="inline-flex items-center gap-1 text-yellow-600">
                            <AlertCircle className="h-3 w-3" />
                            Exists
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <Check className="h-3 w-3" />
                            New
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.total > 10 && (
                <div className="px-4 py-2 bg-gray-50 text-sm text-gray-500 text-center">
                  And {preview.total - 10} more contacts...
                </div>
              )}
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto text-blue-500 animate-spin" />
            <p className="mt-4 text-lg font-medium text-gray-700">
              Importing contacts...
            </p>
            <p className="mt-1 text-sm text-gray-500">This may take a moment</p>
          </div>
        )}

        {step === "complete" && result && (
          <div className="space-y-6">
            {/* Result summary */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">
                Import Complete
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {result.summary.created}
                </div>
                <div className="text-sm text-green-600">Created</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {result.summary.updated}
                </div>
                <div className="text-sm text-blue-600">Updated</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-600">
                  {result.summary.skipped}
                </div>
                <div className="text-sm text-gray-600">Skipped</div>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-red-600">
                  {result.summary.errors}
                </div>
                <div className="text-sm text-red-600">Errors</div>
              </div>
            </div>

            {/* Error details */}
            {result.summary.errors > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <div className="bg-red-50 px-4 py-2 font-medium text-red-700">
                  Errors ({result.summary.errors})
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {result.results
                    .filter((r) => r.status === "error")
                    .map((r) => (
                      <div
                        key={r.row}
                        className="px-4 py-2 border-t border-red-100 text-sm flex justify-between"
                      >
                        <span>
                          Row {r.row}: {r.phoneNumber}
                        </span>
                        <span className="text-red-600">{r.error}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
        {step === "upload" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <FileText className="h-4 w-4" />
            Supported format: CSV
          </div>
        )}

        {step === "preview" && (
          <button
            onClick={handleReset}
            className="text-gray-600 hover:text-gray-800"
          >
            Choose different file
          </button>
        )}

        {step === "complete" && (
          <button
            onClick={handleReset}
            className="text-gray-600 hover:text-gray-800"
          >
            Import more
          </button>
        )}

        <div className="flex gap-3">
          {onClose && step !== "importing" && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              {step === "complete" ? "Done" : "Cancel"}
            </button>
          )}

          {step === "preview" && (
            <button
              onClick={handleImport}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Import {preview?.total} contacts
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
