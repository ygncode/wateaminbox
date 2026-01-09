import { FileText } from 'lucide-react'
import {
  RightPanelSection,
} from '@/components/layout/right-panel'
import type { DescriptionSectionProps } from './types'

/**
 * Group description section
 */
export function DescriptionSection({ group }: DescriptionSectionProps) {
  return (
    <RightPanelSection title="Description">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary flex-shrink-0" />
        <p className="text-sm text-gray-700 dark:text-dark-text-primary whitespace-pre-wrap">
          {group.description}
        </p>
      </div>
    </RightPanelSection>
  )
}
