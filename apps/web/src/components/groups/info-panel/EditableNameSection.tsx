import { Check, Edit2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  RightPanelSection,
} from '@/components/layout/right-panel'
import { Button, Input } from '@/components/ui'
import { useUpdateGroup } from '@/hooks/useGroups'
import type { EditableNameSectionProps } from './types'

/**
 * Editable custom name section
 */
export function EditableNameSection({ group }: EditableNameSectionProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [customName, setCustomName] = useState(group.customName || '')
  const updateGroup = useUpdateGroup()

  useEffect(() => {
    setCustomName(group.customName || '')
  }, [group.customName])

  const handleSave = async () => {
    await updateGroup.mutateAsync({
      groupId: group.id,
      customName: customName.trim() || undefined,
    })
    setIsEditing(false)
  }

  const handleCancel = () => {
    setCustomName(group.customName || '')
    setIsEditing(false)
  }

  return (
    <RightPanelSection title="Custom Name">
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Enter custom name"
            className="flex-1"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSave}
            disabled={updateGroup.isPending}
            className="h-8 w-8"
          >
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCancel}
            className="h-8 w-8"
          >
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-700 dark:text-dark-text-primary">
            {group.customName || (
              <span className="text-gray-400 dark:text-dark-text-tertiary italic">No custom name set</span>
            )}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8"
          >
            <Edit2 className="h-4 w-4 text-gray-500 dark:text-dark-text-secondary" />
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-dark-text-tertiary">
        Custom name is visible to all team members
      </p>
    </RightPanelSection>
  )
}
