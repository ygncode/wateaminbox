import { Tag } from 'lucide-react'
import {
  RightPanelSection,
} from '@/components/layout/right-panel'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { TagsSectionProps } from './types'

/**
 * Tags section
 */
export function TagsSection({ tags }: TagsSectionProps) {
  if (tags.length === 0) {
    return (
      <RightPanelSection title="Tags">
        <div className="flex items-start gap-2">
          <Tag className="mt-0.5 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
          <p className="text-sm text-gray-400 dark:text-dark-text-tertiary italic">No tags assigned</p>
        </div>
      </RightPanelSection>
    )
  }

  return (
    <RightPanelSection title="Tags">
      <div className="flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className={cn('cursor-default')}
              style={
                tag.color
                  ? { backgroundColor: `${tag.color}20`, color: tag.color }
                  : undefined
              }
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      </div>
    </RightPanelSection>
  )
}
