import { X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Where the right panel is being drawn.
 *
 * `docked` is the desktop third column, which owns its own width and is hidden
 * below `lg`. `embedded` means an ancestor (the mobile/tablet slide-in panel)
 * already provides the surface, so the panel must fill it instead of applying
 * the desktop-only visibility and sizing - applying them there is what left
 * the touch drawer rendering an empty box.
 */
export type RightPanelSurface = "docked" | "embedded" | "sheet";

export const RightPanelSurfaceContext =
  React.createContext<RightPanelSurface>("docked");

export function useRightPanelSurface(): RightPanelSurface {
  return React.useContext(RightPanelSurfaceContext);
}

/** Stable id so a host drawer can name itself from the panel's own heading. */
export const RIGHT_PANEL_TITLE_ID = "right-panel-title";

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
  const surface = useRightPanelSurface();

  // A touch host owns the slide-out transition. Keep its content mounted while
  // that transition runs so closing does not reveal an empty fullscreen panel.
  if (!isOpen && surface === "docked") return null;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col bg-white dark:bg-dark-secondary",
        surface === "docked"
          ? // Desktop third column; the slide-in panel is used below `lg`.
            "hidden border-l border-gray-200 dark:border-dark-border lg:flex lg:w-[350px] xl:w-[400px]"
          : "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export interface RightPanelHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  onClose?: () => void;
}

export function RightPanelHeader({
  className,
  title,
  onClose,
  ...props
}: RightPanelHeaderProps) {
  const { t } = useTranslation();
  const surface = useRightPanelSurface();

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-4 px-4",
        surface === "sheet"
          ? "h-14 touch-none border-b border-black/[0.07] bg-white text-[#111b21] dark:border-white/[0.08] dark:bg-dark-secondary dark:text-dark-text-primary"
          : [
              "bg-whatsapp-teal-green text-white",
              // Responsive height, with the notch inset added on top of the
              // row rather than subtracted from it.
              "h-[calc(3.5rem+env(safe-area-inset-top))] md:h-[calc(3.75rem+env(safe-area-inset-top))]",
              "safe-area-top",
            ],
        className,
      )}
      {...props}
    >
      {onClose && (
        <button
          onClick={onClose}
          className={cn(
            "flex h-10 w-10 touch-manipulation items-center justify-center rounded-full transition-colors",
            surface === "sheet"
              ? "text-[#54656f] hover:bg-black/[0.055] active:bg-black/10 dark:text-dark-text-secondary dark:hover:bg-white/[0.06]"
              : "hover:bg-white/10",
          )}
          aria-label={t("common.closePanel", "Close panel")}
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <h2
        id={surface !== "docked" ? RIGHT_PANEL_TITLE_ID : undefined}
        className="text-lg font-medium"
      >
        {title}
      </h2>
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

export interface RightPanelSectionProps
  extends React.HTMLAttributes<HTMLDivElement> {
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
