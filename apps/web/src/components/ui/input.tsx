import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

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
          "flex h-9 w-full rounded-lg px-3 py-1 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg border border-line-strong bg-field text-sm text-fg shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle hover:border-fg-subtle/60 focus-visible:border-fg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/15 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60",
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
