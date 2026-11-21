import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary shadow-xs hover:bg-primary-hover",
        destructive: "bg-danger text-on-danger shadow-xs hover:bg-danger-hover",
        outline:
          "border border-line-strong bg-surface text-fg shadow-xs hover:border-fg-subtle hover:bg-muted",
        secondary: "bg-muted text-fg hover:bg-muted-strong",
        ghost: "text-fg-muted hover:bg-muted hover:text-fg",
        link: "h-auto px-0 text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
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
