import { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { Input } from "./input";

export interface FormFieldProps {
  label: string;
  id: string;
  type?: "text" | "email" | "password" | "tel";
  placeholder?: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  hint?: string;
}

/**
 * Form field component with label, input, and error display
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
