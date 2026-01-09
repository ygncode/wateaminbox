import { AlertCircle, Check } from 'lucide-react'
import type { PreviewStepProps } from './types'

export function PreviewStep({ preview, options, onOptionsChange }: PreviewStepProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{preview.total}</div>
          <div className="text-sm text-blue-600 dark:text-blue-400">Total contacts</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {preview.newCount}
          </div>
          <div className="text-sm text-green-600 dark:text-green-400">New contacts</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {preview.existingCount}
          </div>
          <div className="text-sm text-yellow-600 dark:text-yellow-400">Already exist</div>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.updateExisting}
            onChange={(e) => onOptionsChange({ ...options, updateExisting: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 dark:border-dark-border text-blue-600 focus:ring-blue-500 dark:bg-dark-tertiary"
          />
          <span className="text-sm text-gray-700 dark:text-dark-text-primary">
            Update existing contacts with new data
          </span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.createTags}
            onChange={(e) => onOptionsChange({ ...options, createTags: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 dark:border-dark-border text-blue-600 focus:ring-blue-500 dark:bg-dark-tertiary"
          />
          <span className="text-sm text-gray-700 dark:text-dark-text-primary">
            Create new tags if they don't exist
          </span>
        </label>
      </div>

      {/* Preview table */}
      <div className="border border-gray-200 dark:border-dark-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-dark-tertiary">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-dark-text-secondary">
                #
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-dark-text-secondary">
                Phone
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-dark-text-secondary">
                Name
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-dark-text-secondary">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-dark-border">
            {preview.preview.slice(0, 10).map((row) => (
              <tr key={row.row} className="hover:bg-gray-50 dark:hover:bg-dark-tertiary">
                <td className="px-4 py-2 text-gray-500 dark:text-dark-text-tertiary">{row.row}</td>
                <td className="px-4 py-2 text-gray-900 dark:text-dark-text-primary">
                  {row.phoneNumber}
                </td>
                <td className="px-4 py-2 text-gray-900 dark:text-dark-text-primary">
                  {row.name || '-'}
                </td>
                <td className="px-4 py-2">
                  {row.exists ? (
                    <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                      <AlertCircle className="h-3 w-3" />
                      Exists
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
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
          <div className="px-4 py-2 bg-gray-50 dark:bg-dark-tertiary text-sm text-gray-500 dark:text-dark-text-secondary text-center">
            And {preview.total - 10} more contacts...
          </div>
        )}
      </div>
    </div>
  )
}
