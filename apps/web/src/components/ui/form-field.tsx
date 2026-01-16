import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { Input } from "./input";

export interface FormFieldProps {
  /** Field label text */
  label: string;
  /** Unique ID for the input element */
  id: string;
  /** Input type - affects spellcheck and inputMode behavior */
  type?: "text" | "email" | "password" | "tel" | "url" | "number";
  /** Placeholder text (use ellipsis at end for pattern hints) */
  placeholder?: string;
  /** React Hook Form registration object */
  registration: UseFormRegisterReturn;
  /** Validation error from React Hook Form */
  error?: FieldError;
  /**
   * Autocomplete attribute for browser autofill.
   * See: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
   */
  autoComplete?: string;
  /** Whether to focus this input on mount */
  autoFocus?: boolean;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper */
  className?: string;
  /** Hint text displayed below the input when no error */
  hint?: string;
  /**
   * Input mode for mobile keyboards.
   * Auto-detected from type for email/tel, but can be overridden.
   */
  inputMode?:
    | "none"
    | "text"
    | "decimal"
    | "numeric"
    | "tel"
    | "search"
    | "email"
    | "url";
}

/**
 * Form field component with label, input, and error display
 *
 * Features:
 * - Automatic spellcheck disabling for email/password/url types
 * - Automatic inputMode selection for email/tel types
 * - Proper ARIA attributes for accessibility
 * - Error and hint text display with aria-describedby linking
 */
export function FormField({
  label,
  id,
  type = "text",
  placeholder,
  registration,
  error,
  autoComplete,
  autoFocus,
  disabled,
  className,
  hint,
  inputMode,
}: FormFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1"
      >
        {label}
      </label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        inputMode={inputMode}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        {...registration}
      />
      {hint && !error && (
        <p
          id={`${id}-hint`}
          className="mt-1 text-xs text-gray-500 dark:text-dark-text-tertiary"
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="mt-1 text-xs text-red-500 dark:text-red-400"
          role="alert"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
