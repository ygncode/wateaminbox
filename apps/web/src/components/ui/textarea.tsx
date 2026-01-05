import * as React from 'react'

import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-tertiary px-3 py-2 text-sm text-gray-900 dark:text-dark-text-primary shadow-sm placeholder:text-gray-500 dark:placeholder:text-dark-text-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-whatsapp-green disabled:cursor-not-allowed disabled:opacity-50 resize-none',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
