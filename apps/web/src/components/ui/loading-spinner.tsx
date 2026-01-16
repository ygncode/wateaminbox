import { cn } from "@/lib/utils";

export interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: "xs" | "sm" | "md" | "lg";
  /** Additional CSS class names */
  className?: string;
  /**
   * Accessible label for the spinner.
   * When provided, adds role="status" and aria-label.
   * When not provided, the spinner is decorative (aria-hidden="true").
   */
  label?: string;
}

const sizeClasses = {
  xs: "h-4 w-4",
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

/**
 * Loading spinner component
 *
 * A reusable loading indicator with configurable sizes.
 *
 * @example
 * // Default medium size
 * <LoadingSpinner />
 *
 * @example
 * // Small size
 * <LoadingSpinner size="sm" />
 *
 * @example
 * // With custom color
 * <LoadingSpinner className="text-blue-500" />
 */
export function LoadingSpinner({
  size = "md",
  className,
  label,
}: LoadingSpinnerProps) {
  // When label is provided, the spinner is accessible; otherwise decorative
  const accessibilityProps = label
    ? { role: "status" as const, "aria-label": label }
    : { "aria-hidden": true as const };

  return (
    <svg
      className={cn(
        "animate-spin text-whatsapp-green",
        sizeClasses[size],
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      {...accessibilityProps}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
