---
title: Compose Radix Primitives with Tailwind
impact: MEDIUM
impactDescription: accessible, maintainable components
tags: ui, radix, tailwind, composition
---

## Compose Radix Primitives with Tailwind

Build accessible components by composing Radix UI primitives with Tailwind CSS classes.

**Incorrect (custom accessibility implementation):**

```tsx
function CustomDialog({ open, onClose, children }) {
  // Manual focus trap, escape handling, aria attributes...
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={open ? 'block' : 'hidden'}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>
  )
}
```

**Correct (Radix primitive with Tailwind):**

```tsx
import * as Dialog from '@radix-ui/react-dialog'

function Modal({ open, onOpenChange, title, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold">
            {title}
          </Dialog.Title>
          {children}
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

**Reusable component with variants (CVA):**

```tsx
import { cva, type VariantProps } from 'class-variance-authority'
import * as Dialog from '@radix-ui/react-dialog'

const dialogContentVariants = cva(
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg',
  {
    variants: {
      size: {
        sm: 'w-full max-w-sm',
        md: 'w-full max-w-md',
        lg: 'w-full max-w-lg',
        xl: 'w-full max-w-xl',
        full: 'w-[calc(100%-2rem)] h-[calc(100%-2rem)]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

interface DialogContentProps
  extends Dialog.DialogContentProps,
    VariantProps<typeof dialogContentVariants> {}

const DialogContent = ({ size, className, ...props }: DialogContentProps) => (
  <Dialog.Content
    className={cn(dialogContentVariants({ size }), className)}
    {...props}
  />
)
```

**Compound component pattern:**

```tsx
// components/ui/dialog.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = ({ className, ...props }) => (
  <DialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80',
      className
    )}
    {...props}
  />
)

const DialogContent = ({ className, children, ...props }) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
        'w-full max-w-lg rounded-lg bg-white p-6 shadow-lg',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
)

export { Dialog, DialogTrigger, DialogContent, DialogClose }

// Usage
<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent>
    <h2>Title</h2>
    <p>Content</p>
  </DialogContent>
</Dialog>
```
