import { Calendar, User } from 'lucide-react'
import { dayjs } from '@whatsapp-web/shared'
import {
  RightPanelSection,
} from '@/components/layout/right-panel'
import type { GroupInfoSectionProps } from './types'

/**
 * Group info section with creation date
 */
export function GroupInfoSection({ group }: GroupInfoSectionProps) {
  const createdDate = dayjs(group.createdAt).format('MMMM D, YYYY')

  return (
    <RightPanelSection>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">Created</p>
            <p className="text-xs text-gray-500 dark:text-dark-text-secondary">{createdDate}</p>
          </div>
        </div>
        {group.createdBy && (
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">Created by</p>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">{group.createdBy}</p>
            </div>
          </div>
        )}
      </div>
    </RightPanelSection>
  )
}
