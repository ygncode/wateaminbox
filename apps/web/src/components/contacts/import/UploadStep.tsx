import { AlertTriangle, Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { downloadImportTemplate } from "../../../lib/api";
import type { UploadStepProps } from "./types";

export function UploadStep({
  loading,
  onFileSelect,
  connections,
  selectedConnectionId,
  onSelectConnection,
}: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      await downloadImportTemplate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not download the CSV template",
      );
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // Imported contacts are linked to a WhatsApp account so they can be
  // messaged. With several connected accounts the choice must be explicit.
  const needsSelection = connections.length > 1 && !selectedConnectionId;
  const uploadDisabled = connections.length === 0 || needsSelection;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (uploadDisabled) return;
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".csv")) {
      onFileSelect(droppedFile);
    }
  };

  const connectionLabel = (connection: (typeof connections)[number]) =>
    connection.phoneNumber
      ? `${connection.name} (${connection.phoneNumber})`
      : connection.name;

  return (
    <div className="space-y-6">
      {/* Target WhatsApp account */}
      {connections.length === 0 && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">
            Connect a WhatsApp account before importing. Imported contacts are
            linked to an account so they can be messaged.
          </span>
        </div>
      )}
      {connections.length === 1 && (
        <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
          Contacts will be linked to{" "}
          <span className="font-medium text-gray-900 dark:text-dark-text-primary">
            {connectionLabel(connections[0])}
          </span>
        </p>
      )}
      {connections.length > 1 && (
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-dark-text-primary">
            WhatsApp account for imported contacts
          </span>
          <select
            value={selectedConnectionId ?? ""}
            onChange={(e) => onSelectConnection(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-tertiary px-3 py-2 text-sm text-gray-900 dark:text-dark-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="" disabled>
              Choose an account…
            </option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionLabel(connection)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`border-2 border-dashed border-gray-300 dark:border-dark-border rounded-lg p-8 text-center dark:bg-dark-tertiary transition-colors ${
          uploadDisabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer"
        }`}
        onClick={() => {
          if (!uploadDisabled) fileInputRef.current?.click();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) onFileSelect(selectedFile);
          }}
        />
        {loading ? (
          <Loader2 className="h-12 w-12 mx-auto text-blue-500 dark:text-blue-400 animate-spin" />
        ) : (
          <Upload className="h-12 w-12 mx-auto text-gray-400 dark:text-dark-text-tertiary" />
        )}
        <p className="mt-4 text-lg font-medium text-gray-700 dark:text-dark-text-primary">
          Drop your CSV file here
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-text-secondary">
          or click to browse
        </p>
      </div>

      {/* Download template */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          disabled={downloadingTemplate}
          className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-60"
        >
          {downloadingTemplate ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download CSV template
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 dark:bg-dark-tertiary rounded-lg p-4">
        <h3 className="font-medium text-gray-900 dark:text-dark-text-primary mb-2">
          CSV Format
        </h3>
        <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-3">
          Your CSV file should include a header row with these columns:
        </p>
        <ul className="text-sm text-gray-600 dark:text-dark-text-secondary space-y-1">
          <li>
            <strong>phone_number</strong> (required) - Phone number with country
            code
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
  );
}
