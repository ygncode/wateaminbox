import { Archive, Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { useTags } from '@/hooks/useContact'
import {
  type ExportFormat,
  useExportContacts,
  useExportConversation,
  useExportMessages,
  useFullBackupExport,
} from '@/hooks/useExport'

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: 'contacts' | 'messages' | 'conversation' | 'full-backup'
  contactId?: string
  contactName?: string
}

export function ExportDialog({
  open,
  onOpenChange,
  type,
  contactId,
  contactName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [hasCustomName, setHasCustomName] = useState(false)

  const { data: tags } = useTags()
  const exportContacts = useExportContacts()
  const exportMessages = useExportMessages()
  const exportConversation = useExportConversation()
  const fullBackupExport = useFullBackupExport()

  const isLoading =
    exportContacts.isPending ||
    exportMessages.isPending ||
    exportConversation.isPending ||
    fullBackupExport.isPending

  const getDateRange = () => {
    if (dateRange === 'all') return {}
    const end = new Date()
    const start = new Date()
    if (dateRange === '7d') start.setDate(start.getDate() - 7)
    else if (dateRange === '30d') start.setDate(start.getDate() - 30)
    else start.setDate(start.getDate() - 90)
    return { startDate: start.toISOString(), endDate: end.toISOString() }
  }

  const handleExport = async () => {
    try {
      if (type === 'contacts') {
        await exportContacts.mutateAsync({
          format,
          filters: {
            tagIds: selectedTags.length > 0 ? selectedTags : undefined,
            hasCustomName: hasCustomName || undefined,
          },
        })
      } else if (type === 'messages') {
        const dates = getDateRange()
        await exportMessages.mutateAsync({
          format,
          filters: {
            ...dates,
          },
        })
      } else if (type === 'conversation' && contactId) {
        const dates = getDateRange()
        await exportConversation.mutateAsync({
          contactId,
          format,
          ...dates,
        })
      } else if (type === 'full-backup') {
        const dates = getDateRange()
        await fullBackupExport.mutateAsync(dates)
      }
      onOpenChange(false)
    } catch {
      // Error handled by mutation
    }
  }

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'full-backup' ? (
              <Archive className="h-5 w-5" />
            ) : (
              <Download className="h-5 w-5" />
            )}
            {type === 'full-backup'
              ? 'Full Backup'
              : `Export ${
                  type === 'contacts'
                    ? 'Contacts'
                    : type === 'messages'
                      ? 'Messages'
                      : `Conversation${contactName ? ` with ${contactName}` : ''}`
                }`}
          </DialogTitle>
          <DialogDescription>
            {type === 'full-backup'
              ? 'Download a complete backup of all your data as a ZIP file'
              : 'Choose your export format and filters'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Full backup info */}
          {type === 'full-backup' && (
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">Your backup will include:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All contacts (JSON and CSV)</li>
                <li>All messages (JSON and CSV)</li>
                <li>Backup summary with statistics</li>
                <li>README file with documentation</li>
              </ul>
            </div>
          )}

          {/* Format selection - only for non-full-backup */}
          {type !== 'full-backup' && (
            <div className="space-y-2">
              <Label>Format</Label>
              <div className="flex gap-2">
                <Button
                  variant={format === 'csv' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setFormat('csv')}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  CSV
                </Button>
                <Button
                  variant={format === 'json' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setFormat('json')}
                >
                  <FileJson className="h-4 w-4 mr-2" />
                  JSON
                </Button>
              </div>
            </div>
          )}

          {/* Date range for messages/conversations/full-backup */}
          {(type === 'messages' || type === 'conversation' || type === 'full-backup') && (
            <div className="space-y-2">
              <Label>Date Range</Label>
              <Select value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              {type === 'conversation' && dateRange === 'all' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Note: Exports are limited to 50,000 messages. Use date ranges for very large
                  conversations.
                </p>
              )}
            </div>
          )}

          {/* Contact filters */}
          {type === 'contacts' && (
            <>
              {/* Has custom name filter */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="hasCustomName"
                  checked={hasCustomName}
                  onCheckedChange={(checked) => setHasCustomName(checked === true)}
                />
                <Label htmlFor="hasCustomName" className="text-sm font-normal">
                  Only contacts with custom names
                </Label>
              </div>

              {/* Tag filter */}
              {tags && tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Filter by Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          selectedTags.includes(tag.id)
                            ? 'bg-whatsapp-teal-green text-white border-whatsapp-teal-green'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                        }`}
                        style={
                          selectedTags.includes(tag.id)
                            ? undefined
                            : tag.color
                              ? { borderColor: tag.color, color: tag.color }
                              : undefined
                        }
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isLoading}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {type === 'full-backup' ? 'Creating Backup...' : 'Exporting...'}
              </>
            ) : (
              <>
                {type === 'full-backup' ? (
                  <Archive className="h-4 w-4 mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {type === 'full-backup' ? 'Download Backup' : 'Export'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ExportDialog
