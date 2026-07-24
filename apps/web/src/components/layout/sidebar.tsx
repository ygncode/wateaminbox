import type * as React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Sidebar({ className, children, ...props }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary",
        // Width is controlled by the responsive layout or desktop resize handle.
        "w-full",
        // Mobile: full width, no border
        "max-md:border-r-0",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export interface SidebarHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function SidebarHeader({
  className,
  children,
  ...props
}: SidebarHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-gray-200 dark:border-dark-border bg-gray-100 dark:bg-dark-secondary px-4",
        // Responsive height with safe area support
        "h-14 min-h-[56px] md:h-[60px] md:min-h-[60px]",
        // Safe area inset for notch
        "safe-area-top",
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export interface SidebarSearchProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function SidebarSearch({
  className,
  children,
  ...props
}: SidebarSearchProps) {
  return (
    <div
      className={cn(
        "border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary p-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface SidebarContentProps {
  className?: string;
  children: React.ReactNode;
}

export function SidebarContent({ className, children }: SidebarContentProps) {
  return (
    <ScrollArea className={cn("flex-1", className)}>{children}</ScrollArea>
  );
}
