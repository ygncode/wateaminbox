import { Download, Loader2, Upload } from "lucide-react";
import { useRef } from "react";
import { downloadImportTemplate } from "../../../lib/api";
import type { UploadStepProps } from "./types";

export function UploadStep({ loading, onFileSelect }: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".csv")) {
      onFileSelect(droppedFile);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 dark:border-dark-border rounded-lg p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 dark:bg-dark-tertiary transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
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
          onClick={() => downloadImportTemplate()}
          className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          <Download className="h-4 w-4" />
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
