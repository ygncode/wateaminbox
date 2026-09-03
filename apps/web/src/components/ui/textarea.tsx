import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // Focus treatment intentionally mirrors <Input>: the border itself
          // changes color and a soft ring hugs it. The previous offset ring
          // drew a second outline detached from the border, which read as an
          // accidental doubled border.
          "flex min-h-[60px] w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-gray-500 hover:border-slate-400 focus-visible:border-[#0a7c43] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#25d366]/20 aria-invalid:border-red-500 aria-invalid:bg-red-50/35 aria-invalid:focus-visible:border-red-500 aria-invalid:focus-visible:ring-red-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary dark:hover:border-slate-500 dark:focus-visible:border-[#52df83] dark:focus-visible:ring-[#25d366]/15 dark:aria-invalid:border-red-500 dark:aria-invalid:bg-red-950/10 dark:aria-invalid:focus-visible:border-red-400 dark:aria-invalid:focus-visible:ring-red-400/15 dark:disabled:bg-dark-secondary",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
