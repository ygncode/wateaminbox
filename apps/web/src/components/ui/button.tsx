import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-teal-green focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-whatsapp-green text-white shadow hover:bg-whatsapp-dark-green",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700",
        outline:
          "border border-gray-300 bg-white shadow-sm hover:bg-gray-100 hover:text-gray-900 dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-primary dark:hover:bg-dark-tertiary dark:hover:text-dark-text-primary",
        secondary:
          "bg-gray-100 text-gray-900 shadow-sm hover:bg-gray-200 dark:bg-dark-tertiary dark:text-dark-text-primary dark:hover:bg-dark-border",
        ghost:
          "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-dark-tertiary dark:hover:text-dark-text-primary",
        link: "text-whatsapp-green underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** Base button props without accessibility requirements */
interface BaseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Icon-only buttons MUST have an aria-label for accessibility.
 * This type enforces that requirement at compile time.
 */
type IconButtonProps = BaseButtonProps & {
  size: "icon";
  "aria-label": string;
};

/**
 * Non-icon buttons don't require aria-label (though it can still be provided).
 */
type NonIconButtonProps = BaseButtonProps & {
  size?: Exclude<BaseButtonProps["size"], "icon">;
};

/**
 * Button component props - enforces aria-label for icon-only buttons.
 *
 * @example
 * // Icon button - aria-label required
 * <Button size="icon" aria-label="Close menu"><X /></Button>
 *
 * // Regular button - aria-label optional
 * <Button>Click me</Button>
 */
export type ButtonProps = IconButtonProps | NonIconButtonProps;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: React.ElementType = asChild ? Slot : "button";

    // Development-only warning for icon buttons without aria-label
    if (
      process.env.NODE_ENV === "development" &&
      size === "icon" &&
      !props["aria-label"]
    ) {
      console.warn(
        "[Button] Icon-only buttons should have an aria-label for accessibility. " +
          "Add aria-label prop to describe the button's action.",
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
