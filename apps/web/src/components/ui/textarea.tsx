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
          "flex min-h-[60px] w-full resize-none rounded-lg px-3 py-2 border border-line-strong bg-field text-sm text-fg shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle hover:border-fg-subtle/60 focus-visible:border-fg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/15 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60",
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
