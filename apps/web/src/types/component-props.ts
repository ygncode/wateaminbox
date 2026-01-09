/**
 * Composable Props Interface Utilities
 *
 * This module provides reusable, composable type interfaces for common
 * component props patterns. Use these to ensure consistency across components
 * and reduce boilerplate.
 *
 * @example
 * ```tsx
 * // Compose multiple prop interfaces
 * interface MyButtonProps extends
 *   WithChildrenProps,
 *   WithClassNameProps,
 *   WithLoadingProps,
 *   WithDisabledProps {
 *   onClick: () => void
 * }
 *
 * // Or use the utility type
 * type MyInputProps = ComposableProps<
 *   'children' | 'className' | 'loading' | 'error',
 *   { value: string; onChange: (value: string) => void }
 * >
 * ```
 */

import type { ReactNode, CSSProperties, HTMLAttributes, RefObject } from 'react'

// ============================================================================
// Base Props Interfaces
// ============================================================================

/**
 * Props for components that accept children
 *
 * @example
 * ```tsx
 * interface CardProps extends WithChildrenProps {
 *   title: string
 * }
 *
 * function Card({ title, children }: CardProps) {
 *   return <div><h2>{title}</h2>{children}</div>
 * }
 * ```
 */
export interface WithChildrenProps {
  children?: ReactNode
}

/**
 * Props for components that accept required children
 */
export interface WithRequiredChildrenProps {
  children: ReactNode
}

/**
 * Props for components that accept a className for styling
 *
 * @example
 * ```tsx
 * interface ButtonProps extends WithClassNameProps {
 *   label: string
 * }
 *
 * function Button({ label, className }: ButtonProps) {
 *   return <button className={cn('btn', className)}>{label}</button>
 * }
 * ```
 */
export interface WithClassNameProps {
  className?: string
}

/**
 * Props for components that accept inline styles
 */
export interface WithStyleProps {
  style?: CSSProperties
}

/**
 * Props for components that support loading state
 *
 * @example
 * ```tsx
 * interface SubmitButtonProps extends WithLoadingProps {
 *   onClick: () => void
 * }
 *
 * function SubmitButton({ isLoading, onClick }: SubmitButtonProps) {
 *   return <button disabled={isLoading} onClick={onClick}>
 *     {isLoading ? <Spinner /> : 'Submit'}
 *   </button>
 * }
 * ```
 */
export interface WithLoadingProps {
  isLoading?: boolean
}

/**
 * Props for components that display error state
 *
 * @example
 * ```tsx
 * interface FormFieldProps extends WithErrorProps {
 *   label: string
 *   value: string
 * }
 *
 * function FormField({ label, value, error }: FormFieldProps) {
 *   return <div>
 *     <label>{label}</label>
 *     <input value={value} />
 *     {error && <span className="error">{error}</span>}
 *   </div>
 * }
 * ```
 */
export interface WithErrorProps {
  error?: string | null
}

/**
 * Props for components that can be disabled
 */
export interface WithDisabledProps {
  disabled?: boolean
}

/**
 * Props for components that can be read-only
 */
export interface WithReadOnlyProps {
  readOnly?: boolean
}

/**
 * Props for components with a generic onChange handler
 *
 * @example
 * ```tsx
 * interface SelectProps<T> extends WithOnChangeProps<T> {
 *   options: T[]
 *   value: T
 * }
 * ```
 */
export interface WithOnChangeProps<T> {
  onChange?: (value: T) => void
}

/**
 * Props for components with a required onChange handler
 */
export interface WithRequiredOnChangeProps<T> {
  onChange: (value: T) => void
}

/**
 * Props for components with click handler
 */
export interface WithOnClickProps {
  onClick?: () => void
}

/**
 * Props for components with required click handler
 */
export interface WithRequiredOnClickProps {
  onClick: () => void
}

/**
 * Props for components with open/close state
 *
 * @example
 * ```tsx
 * interface ModalProps extends WithOpenProps {
 *   title: string
 * }
 *
 * function Modal({ open, onOpenChange, title }: ModalProps) {
 *   if (!open) return null
 *   return <Dialog onClose={() => onOpenChange?.(false)}>{title}</Dialog>
 * }
 * ```
 */
export interface WithOpenProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Props for components with required open/close state
 */
export interface WithRequiredOpenProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Props for components with a label
 */
export interface WithLabelProps {
  label?: string
}

/**
 * Props for components with a required label
 */
export interface WithRequiredLabelProps {
  label: string
}

/**
 * Props for components with placeholder text
 */
export interface WithPlaceholderProps {
  placeholder?: string
}

/**
 * Props for components with a description or helper text
 */
export interface WithDescriptionProps {
  description?: string
}

/**
 * Props for components that accept a ref
 */
export interface WithRefProps<T extends HTMLElement> {
  ref?: RefObject<T>
}

/**
 * Props for components with testId for testing
 */
export interface WithTestIdProps {
  'data-testid'?: string
}

/**
 * Props for components that are selectable
 */
export interface WithSelectionProps {
  isSelected?: boolean
  onSelect?: () => void
}

/**
 * Props for components that are required selection
 */
export interface WithRequiredSelectionProps {
  isSelected: boolean
  onSelect: () => void
}

/**
 * Props for components with a value
 */
export interface WithValueProps<T> {
  value?: T
}

/**
 * Props for components with a required value
 */
export interface WithRequiredValueProps<T> {
  value: T
}

/**
 * Props for controlled input components
 *
 * @example
 * ```tsx
 * interface TextInputProps extends WithControlledValueProps<string>, WithClassNameProps {
 *   placeholder?: string
 * }
 * ```
 */
export interface WithControlledValueProps<T> {
  value: T
  onChange: (value: T) => void
}

/**
 * Props for components with async submission
 */
export interface WithAsyncSubmitProps {
  isSubmitting?: boolean
  onSubmit?: () => Promise<void> | void
}

/**
 * Props for components with async submission (required)
 */
export interface WithRequiredAsyncSubmitProps {
  isSubmitting: boolean
  onSubmit: () => Promise<void> | void
}

/**
 * Props for components that can be archived or hidden
 */
export interface WithArchiveProps {
  isArchived?: boolean
  onArchive?: () => void
  onUnarchive?: () => void
}

// ============================================================================
// Compound Props Patterns
// ============================================================================

/**
 * Common props for form input components
 */
export interface FormInputProps
  extends WithClassNameProps,
    WithLabelProps,
    WithPlaceholderProps,
    WithErrorProps,
    WithDisabledProps,
    WithReadOnlyProps,
    WithDescriptionProps {}

/**
 * Common props for list item components
 */
export interface ListItemProps
  extends WithClassNameProps,
    WithSelectionProps,
    WithOnClickProps {}

/**
 * Common props for dialog/modal components
 */
export interface DialogProps
  extends WithRequiredOpenProps,
    WithChildrenProps,
    WithClassNameProps {}

/**
 * Common props for action button components
 */
export interface ActionButtonProps
  extends WithClassNameProps,
    WithLoadingProps,
    WithDisabledProps,
    WithRequiredOnClickProps {}

/**
 * Common props for card components
 */
export interface CardProps
  extends WithChildrenProps,
    WithClassNameProps,
    WithOnClickProps {}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Pick specific composable props and merge with additional props
 *
 * @example
 * ```tsx
 * type ButtonProps = ComposableProps<
 *   'children' | 'className' | 'loading' | 'disabled',
 *   { variant: 'primary' | 'secondary' }
 * >
 * // Results in: { children?: ReactNode, className?: string, isLoading?: boolean, disabled?: boolean, variant: 'primary' | 'secondary' }
 * ```
 */
export type ComposableProps<
  K extends ComposablePropKey,
  AdditionalProps = object,
> = (K extends 'children' ? WithChildrenProps : object) &
  (K extends 'className' ? WithClassNameProps : object) &
  (K extends 'style' ? WithStyleProps : object) &
  (K extends 'loading' ? WithLoadingProps : object) &
  (K extends 'error' ? WithErrorProps : object) &
  (K extends 'disabled' ? WithDisabledProps : object) &
  (K extends 'onClick' ? WithOnClickProps : object) &
  (K extends 'open' ? WithOpenProps : object) &
  (K extends 'label' ? WithLabelProps : object) &
  (K extends 'placeholder' ? WithPlaceholderProps : object) &
  (K extends 'description' ? WithDescriptionProps : object) &
  (K extends 'testId' ? WithTestIdProps : object) &
  (K extends 'selection' ? WithSelectionProps : object) &
  AdditionalProps

/**
 * Available keys for ComposableProps utility
 */
export type ComposablePropKey =
  | 'children'
  | 'className'
  | 'style'
  | 'loading'
  | 'error'
  | 'disabled'
  | 'onClick'
  | 'open'
  | 'label'
  | 'placeholder'
  | 'description'
  | 'testId'
  | 'selection'

/**
 * Extract HTML attributes for a specific element type, excluding ref
 */
export type HTMLProps<T extends HTMLElement> = Omit<
  HTMLAttributes<T>,
  'ref' | 'className' | 'style'
>

/**
 * Merge component props with HTML element props
 *
 * @example
 * ```tsx
 * type InputProps = MergeWithHTML<
 *   { label: string; error?: string },
 *   HTMLInputElement
 * >
 * ```
 */
export type MergeWithHTML<
  ComponentProps,
  Element extends HTMLElement,
> = ComponentProps & Omit<HTMLProps<Element>, keyof ComponentProps>
