import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-tertiary px-3 py-1 text-sm text-gray-900 dark:text-dark-text-primary shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-gray-900 dark:file:text-dark-text-primary placeholder:text-gray-500 dark:placeholder:text-dark-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-teal-green focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
