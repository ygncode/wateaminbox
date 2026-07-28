import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, spellCheck, inputMode, ...props }, ref) => {
    // Automatically disable spellcheck for email and password inputs
    // These input types should never have spellcheck enabled
    const shouldDisableSpellcheck =
      type === "email" || type === "password" || type === "url";
    const effectiveSpellCheck =
      spellCheck ?? (shouldDisableSpellcheck ? false : undefined);

    // Automatically set inputMode for email and tel types if not provided
    const effectiveInputMode =
      inputMode ??
      (type === "email" ? "email" : type === "tel" ? "tel" : undefined);

    return (
      <input
        type={type}
        spellCheck={effectiveSpellCheck}
        inputMode={effectiveInputMode}
        className={cn(
          "flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-gray-900 placeholder:text-gray-500 hover:border-slate-400 focus-visible:border-[#0a7c43] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#25d366]/20 aria-invalid:border-red-500 aria-invalid:bg-red-50/35 aria-invalid:focus-visible:border-red-500 aria-invalid:focus-visible:ring-red-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:file:text-dark-text-primary dark:placeholder:text-dark-text-tertiary dark:hover:border-slate-500 dark:focus-visible:border-[#52df83] dark:focus-visible:ring-[#25d366]/15 dark:aria-invalid:border-red-500 dark:aria-invalid:bg-red-950/10 dark:aria-invalid:focus-visible:border-red-400 dark:aria-invalid:focus-visible:ring-red-400/15 dark:disabled:bg-dark-secondary",
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
