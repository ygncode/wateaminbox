import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-whatsapp-green text-white shadow hover:bg-whatsapp-dark-green",
        secondary:
          "border-transparent bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-dark-tertiary dark:text-dark-text-primary dark:hover:bg-dark-border",
        destructive:
          "border-transparent bg-red-500 text-white shadow hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700",
        outline:
          "text-gray-900 border-gray-300 dark:text-dark-text-primary dark:border-dark-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
