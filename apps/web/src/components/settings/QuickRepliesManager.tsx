import {
  AlertCircle,
  Check,
  Hash,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useQuickReplies } from '@/hooks/useQuickReplies'
import type { QuickReply } from '@/lib/api'

/**
 * Quick Replies Manager Component
 * Allows users to create, edit, and delete quick reply templates
 */
export function QuickRepliesManager() {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingQuickReply, setEditingQuickReply] = useState<QuickReply | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [shortcut, setShortcut] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const {
    quickReplies,
    isLoading,
    error,
    create,
    update,
    delete: deleteQuickReply,
    isCreating,
    isUpdating,
    isDeleting,
  } = useQuickReplies({ search: searchQuery || undefined })

  const filteredQuickReplies = searchQuery
    ? quickReplies.filter(
        (qr) =>
          qr.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) ||
          qr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          qr.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : quickReplies

  const resetForm = () => {
    setShortcut('')
    setTitle('')
    setContent('')
    setFormError(null)
    setSuccess(false)
    setEditingQuickReply(null)
  }

  const openCreateDialog = () => {
    resetForm()
    setIsDialogOpen(true)
  }

  const openEditDialog = (qr: QuickReply) => {
    setEditingQuickReply(qr)
    setShortcut(qr.shortcut)
    setTitle(qr.title)
    setContent(qr.content)
    setFormError(null)
    setIsDialogOpen(true)
  }

  const closeDialog = () => {
    setIsDialogOpen(false)
    resetForm()
  }

  const validateShortcut = (value: string): boolean => {
    return /^[a-zA-Z0-9_-]+$/.test(value)
  }

  const handleSubmit = async () => {
    setFormError(null)

    // Validation
    if (!shortcut.trim()) {
      setFormError(t('quickReplies.errors.shortcutRequired', 'Shortcut is required'))
      return
    }

    if (!validateShortcut(shortcut)) {
      setFormError(
        t(
          'quickReplies.errors.shortcutInvalid',
          'Shortcut can only contain letters, numbers, underscores, and hyphens'
        )
      )
      return
    }

    if (!title.trim()) {
      setFormError(t('quickReplies.errors.titleRequired', 'Title is required'))
      return
    }

    if (!content.trim()) {
      setFormError(t('quickReplies.errors.contentRequired', 'Content is required'))
      return
    }

    try {
      if (editingQuickReply) {
        await update(editingQuickReply.id, {
          shortcut: shortcut.trim(),
          title: title.trim(),
          content: content.trim(),
        })
        closeDialog()
      } else {
        await create({
          shortcut: shortcut.trim(),
          title: title.trim(),
          content: content.trim(),
        })
        setSuccess(true)
        // Auto-close after showing success
        setTimeout(() => {
          closeDialog()
        }, 1000)
      }
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('already exists')) {
          setFormError(
            t(
              'quickReplies.errors.shortcutExists',
              'A quick reply with this shortcut already exists'
            )
          )
        } else {
          setFormError(err.message)
        }
      }
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteQuickReply(id)
      setDeleteConfirmId(null)
    } catch (err) {
      console.error('Failed to delete quick reply:', err)
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>{t('quickReplies.errors.loadFailed', 'Failed to load quick replies')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
        {t(
          'quickReplies.description',
          'Create predefined message templates for quick responses. Type / followed by the shortcut in the message composer to use them.'
        )}
      </p>

      {/* Search and Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-0 bottom-0 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
          </div>
          <Input
            type="text"
            placeholder={t('quickReplies.searchPlaceholder', 'Search quick replies...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          onClick={openCreateDialog}
          className="gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
          data-testid="add-quick-reply-button"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('quickReplies.addNew', 'Add New')}</span>
        </Button>
      </div>

      {/* Quick Replies List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
        </div>
      ) : filteredQuickReplies.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-dark-text-secondary">
          <Zap className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-dark-text-tertiary" />
          <p className="font-medium">
            {searchQuery
              ? t('quickReplies.noResults', 'No quick replies found')
              : t('quickReplies.empty', 'No quick replies yet')}
          </p>
          <p className="text-sm mt-1">
            {searchQuery
              ? t('quickReplies.tryDifferentSearch', 'Try a different search term')
              : t('quickReplies.createFirst', 'Create your first quick reply to get started')}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto" data-testid="quick-replies-list">
          {filteredQuickReplies.map((qr) => (
            <div
              key={qr.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-dark-border hover:border-gray-300 dark:hover:border-dark-text-tertiary hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors group"
              data-testid={`quick-reply-item-${qr.shortcut}`}
            >
              {/* Shortcut badge */}
              <div className="flex-shrink-0">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-gray-100 dark:bg-dark-tertiary text-gray-700 dark:text-dark-text-primary">
                  /{qr.shortcut}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
                  {qr.title}
                </p>
                <p className="text-sm text-gray-500 dark:text-dark-text-secondary line-clamp-2 mt-0.5">
                  {qr.content}
                </p>
              </div>

              {/* Actions */}
              <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditDialog(qr)}
                  className="h-8 w-8 p-0"
                  data-testid={`edit-quick-reply-${qr.shortcut}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmId(qr.id)}
                  className="h-8 w-8 p-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                  data-testid={`delete-quick-reply-${qr.shortcut}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          {/* Header with gradient background */}
          <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white dark:from-emerald-900/20 dark:via-teal-900/10 dark:to-dark-elevated">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-whatsapp-teal-green/10 to-transparent rounded-full blur-2xl" />
            <DialogHeader className="relative">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-whatsapp-teal-green to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
                    {editingQuickReply
                      ? t('quickReplies.editTitle', 'Edit Quick Reply')
                      : t('quickReplies.createTitle', 'Create Quick Reply')}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-500 dark:text-dark-text-secondary mt-0.5">
                    {editingQuickReply
                      ? t('quickReplies.editDescription', 'Update the quick reply details below.')
                      : t('quickReplies.createDescription', 'Create a new quick reply template.')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          {success ? (
            <div className="flex flex-col items-center justify-center py-10 px-6">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-green-400/20 animate-ping" />
                <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-500/30">
                  <Check className="h-8 w-8 text-white" />
                </div>
              </div>
              <p className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary mt-4">
                {t('quickReplies.created', 'Quick Reply Created!')}
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
                {t('quickReplies.createdHint', 'Type /{shortcut} to use it', { shortcut })}
              </p>
              {/* Preview badge */}
              <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-dark-tertiary text-sm font-mono text-gray-700 dark:text-dark-text-primary">
                <span className="text-whatsapp-teal-green">/</span>
                {shortcut}
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="px-6 pb-6 pt-2">
              {/* Server error message */}
              {formError && (
                <div className="flex items-center gap-2.5 p-3 mb-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200/50 dark:border-red-800/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                    <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                  </div>
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-5">
                {/* Shortcut Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="shortcut" className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                      <Hash className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
                      {t('quickReplies.shortcutLabel', 'Shortcut')}
                      <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-xs text-gray-400 dark:text-dark-text-tertiary font-mono">
                      {shortcut.length}/50
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-whatsapp-teal-green font-mono font-semibold text-lg">
                      /
                    </span>
                    <Input
                      id="shortcut"
                      value={shortcut}
                      onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                      placeholder={t('quickReplies.shortcutPlaceholder', 'greeting')}
                      className="pl-8 font-mono text-base h-11 bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
                      maxLength={50}
                      autoFocus
                      data-testid="quick-reply-shortcut-input"
                      aria-describedby="shortcut-hint"
                    />
                  </div>
                  <p id="shortcut-hint" className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                    {t('quickReplies.shortcutHelp', 'Letters, numbers, underscores, and hyphens only')}
                  </p>
                </div>

                {/* Title Input */}
                <div className="space-y-2">
                  <Label htmlFor="title" className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                    <Tag className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
                    {t('quickReplies.titleLabel', 'Title')}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('quickReplies.titlePlaceholder', 'Welcome Message')}
                    className="h-11 bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
                    maxLength={255}
                    data-testid="quick-reply-title-input"
                  />
                  <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                    {t('quickReplies.titleHint', 'A descriptive name to identify this quick reply')}
                  </p>
                </div>

                {/* Content Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="content" className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                      <MessageSquare className="h-3.5 w-3.5 text-gray-400 dark:text-dark-text-tertiary" />
                      {t('quickReplies.contentLabel', 'Message Content')}
                      <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-xs text-gray-400 dark:text-dark-text-tertiary font-mono">
                      {content.length} chars
                    </span>
                  </div>
                  <Textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t(
                      'quickReplies.contentPlaceholder',
                      'Hello! Thank you for reaching out. How can I help you today?'
                    )}
                    rows={4}
                    className="resize-none bg-gray-50 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus:bg-white dark:focus:bg-dark-elevated transition-colors"
                    data-testid="quick-reply-content-input"
                    aria-describedby="content-hint"
                  />
                  <p id="content-hint" className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                    {t('quickReplies.contentHint', 'This message will be sent when you use this quick reply')}
                  </p>
                </div>

                {/* Live Preview */}
                {(shortcut || title || content) && (
                  <div className="p-3 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-dark-tertiary dark:to-dark-secondary border border-gray-200/50 dark:border-dark-border">
                    <p className="text-xs font-medium text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider mb-2">
                      Preview
                    </p>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-whatsapp-teal-green/10 text-whatsapp-teal-green border border-whatsapp-teal-green/20">
                          /{shortcut || '...'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-dark-text-primary truncate">
                          {title || 'Untitled'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-dark-text-secondary line-clamp-2 mt-0.5">
                          {content || 'No content yet...'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-6 mt-2 border-t border-gray-100 dark:border-dark-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={isCreating || isUpdating}
                  className="px-4"
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={isCreating || isUpdating || !shortcut.trim() || !title.trim() || !content.trim()}
                  className="px-5 bg-gradient-to-r from-whatsapp-teal-green to-emerald-600 hover:from-emerald-600 hover:to-whatsapp-teal-green text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-300"
                  data-testid="save-quick-reply-button"
                >
                  {(isCreating || isUpdating) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {editingQuickReply
                        ? t('common.saving', 'Saving...')
                        : t('common.creating', 'Creating...')}
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      {editingQuickReply ? t('common.save', 'Save') : t('common.create', 'Create')}
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('quickReplies.deleteTitle', 'Delete Quick Reply')}</DialogTitle>
            <DialogDescription>
              {t(
                'quickReplies.deleteConfirmation',
                'Are you sure you want to delete this quick reply? This action cannot be undone.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={isDeleting}
              className="gap-2"
              data-testid="confirm-delete-quick-reply"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default QuickRepliesManager
