import { zodResolver } from '@hookform/resolvers/zod'
import { Shield, ShieldCheck, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button, FormField } from '@/components/ui'
import { useInviteMember } from '@/hooks/useTeam'
import { inviteTeamMemberSchema, type InviteTeamMemberFormData } from '@/lib/schemas'
import { cn } from '@/lib/utils'
import type { InviteFormModalProps } from './types'

/**
 * Invite form modal
 */
export function InviteFormModal({ companyId, onClose }: InviteFormModalProps) {
  const inviteMember = useInviteMember()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<InviteTeamMemberFormData>({
    resolver: zodResolver(inviteTeamMemberSchema),
    defaultValues: {
      email: '',
      role: 'member',
    },
    mode: 'onChange',
  })

  const role = watch('role')

  const onSubmit = async (data: InviteTeamMemberFormData) => {
    await inviteMember.mutateAsync({ companyId, email: data.email, role: data.role })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
            Invite Team Member
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 dark:text-dark-text-tertiary hover:bg-gray-100 dark:hover:bg-dark-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            id="email"
            label="Email address"
            type="email"
            placeholder="colleague@company.com"
            registration={register('email')}
            error={errors.email}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1">
              Role
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setValue('role', 'member', { shouldValidate: true })}
                className={cn(
                  'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  role === 'member'
                    ? 'border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green'
                    : 'border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary',
                )}
              >
                <Shield className="mx-auto mb-1 h-5 w-5" />
                Member
              </button>
              <button
                type="button"
                onClick={() => setValue('role', 'admin', { shouldValidate: true })}
                className={cn(
                  'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  role === 'admin'
                    ? 'border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green'
                    : 'border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary',
                )}
              >
                <ShieldCheck className="mx-auto mb-1 h-5 w-5" />
                Admin
              </button>
            </div>
            {errors.role && (
              <p className="mt-1 text-xs text-red-500 dark:text-red-400" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMember.isPending || !isValid}
              className="flex-1 bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
