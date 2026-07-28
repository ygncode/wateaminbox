import { CircleAlert, Eye, EyeOff } from "lucide-react";
import * as React from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { cn } from "@/lib/utils";
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
  /** Add an accessible visibility control for password fields */
  showPasswordToggle?: boolean;
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
  showPasswordToggle = false,
  inputMode,
}: FormFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = React.useState(false);
  const canTogglePassword = type === "password" && showPasswordToggle;
  const resolvedType =
    canTogglePassword && isPasswordVisible ? "text" : type;

  return (
    <div className={cn("group", className)} data-invalid={error ? "" : undefined}>
      <label
        htmlFor={id}
        className={cn(
          "mb-1.5 block text-sm font-semibold text-slate-700 transition-colors duration-200 group-focus-within:text-[#075e54] dark:text-dark-text-secondary dark:group-focus-within:text-[#52df83]",
          error &&
            "text-red-600 group-focus-within:text-red-600 dark:text-red-400 dark:group-focus-within:text-red-400",
        )}
      >
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={resolvedType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          inputMode={inputMode}
          spellCheck={type === "password" ? false : undefined}
          className={canTogglePassword ? "pr-11" : undefined}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={
            error ? `${id}-error` : hint ? `${id}-hint` : undefined
          }
          {...registration}
        />
        {canTogglePassword && (
          <button
            type="button"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-inset disabled:pointer-events-none dark:text-dark-text-tertiary dark:hover:text-dark-text-primary dark:focus-visible:ring-[#52df83]"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            disabled={disabled}
          >
            {isPasswordVisible ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {hint && !error && (
        <p
          id={`${id}-hint`}
          className="mt-1.5 text-xs leading-4 text-gray-500 dark:text-dark-text-tertiary"
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-4 text-red-600 dark:text-red-400"
          role="alert"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-px h-3.5 w-3.5 shrink-0"
          />
          {error.message}
        </p>
      )}
    </div>
  );
}
