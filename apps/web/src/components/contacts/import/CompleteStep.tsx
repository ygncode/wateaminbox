import { Check } from 'lucide-react'
import type { CompleteStepProps } from './types'

export function CompleteStep({ result }: CompleteStepProps) {
  return (
    <div className="space-y-6">
      {/* Result summary */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          Import Complete
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {result.summary.created}
          </div>
          <div className="text-sm text-green-600 dark:text-green-400">Created</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {result.summary.updated}
          </div>
          <div className="text-sm text-blue-600 dark:text-blue-400">Updated</div>
        </div>
        <div className="bg-gray-50 dark:bg-dark-tertiary rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-600 dark:text-dark-text-secondary">
            {result.summary.skipped}
          </div>
          <div className="text-sm text-gray-600 dark:text-dark-text-secondary">Skipped</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {result.summary.errors}
          </div>
          <div className="text-sm text-red-600 dark:text-red-400">Errors</div>
        </div>
      </div>

      {/* Error details */}
      {result.summary.errors > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
          <div className="bg-red-50 dark:bg-red-900/30 px-4 py-2 font-medium text-red-700 dark:text-red-400">
            Errors ({result.summary.errors})
          </div>
          <div className="max-h-40 overflow-y-auto">
            {result.results
              .filter((r) => r.status === 'error')
              .map((r) => (
                <div
                  key={r.row}
                  className="px-4 py-2 border-t border-red-100 dark:border-red-900 text-sm flex justify-between text-gray-700 dark:text-dark-text-primary"
                >
                  <span>
                    Row {r.row}: {r.phoneNumber}
                  </span>
                  <span className="text-red-600 dark:text-red-400">{r.error}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
