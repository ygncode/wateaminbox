import { X } from "lucide-react";
import type * as React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface RightPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  isOpen?: boolean;
  onClose?: () => void;
}

export function RightPanel({
  className,
  children,
  isOpen = false,
  onClose,
  ...props
}: RightPanelProps) {
  if (!isOpen) return null;

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-l border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary",
        // Responsive width - hidden on mobile/tablet (use MobileSlideInPanel instead)
        "hidden lg:flex lg:w-[350px] xl:w-[400px]",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export interface RightPanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  onClose?: () => void;
}

export function RightPanelHeader({
  className,
  title,
  onClose,
  ...props
}: RightPanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center gap-4 bg-whatsapp-teal-green px-4 text-white",
        // Responsive height
        "h-14 min-h-[56px] md:h-[60px] md:min-h-[60px]",
        // Safe area for notch
        "safe-area-top",
        className,
      )}
      {...props}
    >
      {onClose && (
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 transition-colors touch-manipulation"
          aria-label="Close panel"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <h2 className="text-lg font-medium">{title}</h2>
    </header>
  );
}

export interface RightPanelContentProps {
  className?: string;
  children: React.ReactNode;
}

export function RightPanelContent({
  className,
  children,
}: RightPanelContentProps) {
  return (
    <ScrollArea className={cn("flex-1", className)}>{children}</ScrollArea>
  );
}

export interface RightPanelSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: React.ReactNode;
}

export function RightPanelSection({
  className,
  title,
  children,
  ...props
}: RightPanelSectionProps) {
  return (
    <section
      className={cn(
        "border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary p-4",
        className,
      )}
      {...props}
    >
      {title && (
        <h3 className="mb-3 text-sm font-medium text-whatsapp-teal-green">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}
