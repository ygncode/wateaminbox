import { ArrowLeft, X } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  type MobileView,
  resolveMobileView,
} from "./mobile-layout-state";

export type { MobileView } from "./mobile-layout-state";

export interface MobileLayoutContextValue {
  currentView: MobileView;
  setView: (view: MobileView) => void;
  goBack: () => void;
  openContactInfo: () => void;
  closeContactInfo: () => void;
  isContactInfoOpen: boolean;
  selectedChatId: string | null;
  setSelectedChatId: (id: string | null) => void;
}

const MobileLayoutContext =
  React.createContext<MobileLayoutContextValue | null>(null);

export function useMobileLayout() {
  const context = React.useContext(MobileLayoutContext);
  if (!context) {
    throw new Error(
      "useMobileLayout must be used within a MobileLayoutProvider",
    );
  }
  return context;
}

/**
 * Same context, but for components rendered on every breakpoint. Returns null
 * on desktop, where there is no mobile provider and no view stack to pop.
 */
export function useOptionalMobileLayout(): MobileLayoutContextValue | null {
  return React.useContext(MobileLayoutContext);
}

export interface MobileLayoutProviderProps {
  children: React.ReactNode;
  selectedChatId?: string | null;
  onChatSelect?: (chatId: string | null) => void;
}

export function MobileLayoutProvider({
  children,
  selectedChatId = null,
  onChatSelect,
}: MobileLayoutProviderProps) {
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  // The route is the source of truth. A browser edge-swipe changes it
  // synchronously; deriving the visible panel here avoids one or more renders
  // where both the shell chrome and the sliding panels describe different
  // locations (the blank mobile screen this provider previously produced).
  const currentView = resolveMobileView(selectedChatId);

  useEffect(() => {
    if (!selectedChatId) {
      setIsContactInfoOpen(false);
    }
  }, [selectedChatId]);

  const setView = useCallback(
    (view: MobileView) => {
      if (view === "chat-list") {
        setIsContactInfoOpen(false);
        onChatSelect?.(null);
      }
    },
    [onChatSelect],
  );

  const goBack = useCallback(() => {
    if (isContactInfoOpen) {
      setIsContactInfoOpen(false);
      return;
    }
    if (currentView === "message-thread") {
      onChatSelect?.(null);
    }
  }, [currentView, isContactInfoOpen, onChatSelect]);

  const openContactInfo = useCallback(() => {
    setIsContactInfoOpen(true);
  }, []);

  const closeContactInfo = useCallback(() => {
    setIsContactInfoOpen(false);
  }, []);

  const setSelectedChatId = useCallback(
    (id: string | null) => {
      onChatSelect?.(id);
    },
    [onChatSelect],
  );

  const value: MobileLayoutContextValue = {
    currentView,
    setView,
    goBack,
    openContactInfo,
    closeContactInfo,
    isContactInfoOpen,
    selectedChatId,
    setSelectedChatId,
  };

  return (
    <MobileLayoutContext.Provider value={value}>
      {children}
    </MobileLayoutContext.Provider>
  );
}

export interface MobileLayoutProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MobileLayout({
  className,
  children,
  ...props
}: MobileLayoutProps) {
  return (
    <div
      className={cn(
        // The shell already sits inside the app frame (top bar above, floating
        // navigation below), so it fills its parent - `h-dvh`/`w-screen` here
        // would push the composer past the bottom of the visible area.
        "flex h-full w-full overflow-hidden bg-gray-200 dark:bg-dark-primary",
        className,
      )}
      {...props}
    >
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export interface MobileViewContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  view: MobileView;
}

export function MobileViewContainer({
  className,
  children,
  view,
  ...props
}: MobileViewContainerProps) {
  const { currentView } = useMobileLayout();
  const isVisible = currentView === view;

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col bg-white dark:bg-dark-secondary transition-transform duration-300 ease-in-out",
        // Slide animations
        view === "chat-list" &&
          (isVisible ? "translate-x-0" : "-translate-x-full"),
        view === "message-thread" &&
          (isVisible ? "translate-x-0" : "translate-x-full"),
        // Z-index layering
        view === "chat-list" && "z-10",
        view === "message-thread" && "z-20",
        className,
      )}
      aria-hidden={!isVisible}
      // Off-screen views stay mounted to preserve scroll position, so they
      // also have to leave the tab order - `aria-hidden` alone would still let
      // Tab reach the hidden list's rows.
      inert={!isVisible}
      {...props}
    >
      {children}
    </div>
  );
}

export interface MobileHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function MobileHeader({
  className,
  title,
  subtitle,
  showBackButton = false,
  onBack,
  leftContent,
  rightContent,
  ...props
}: MobileHeaderProps) {
  const { t } = useTranslation();

  const { goBack } = useMobileLayout();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      goBack();
    }
  };

  return (
    <header
      className={cn(
        "flex h-14 min-h-[56px] items-center gap-2 border-b border-gray-200 dark:border-dark-border bg-gray-100 dark:bg-dark-secondary px-2 safe-area-top",
        className,
      )}
      {...props}
    >
      {showBackButton && (
        <button
          onClick={handleBack}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 dark:text-dark-text-secondary hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
          aria-label={t("common.goBack", "Go back")}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      )}

      {leftContent}

      {(title || subtitle) && (
        <div className="flex-1 min-w-0">
          {title && (
            <h1 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary truncate">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-dark-text-secondary truncate">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {rightContent && (
        <div className="flex items-center gap-1">{rightContent}</div>
      )}
    </header>
  );
}

export interface MobileSlideInPanelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
  /** Renders the panel's own header bar and names it for assistive tech. */
  title?: string;
  /**
   * Id of a heading rendered by `children`. Use instead of `title` when the
   * content already draws its own header, so the panel does not stack two.
   */
  titleId?: string;
  position?: "left" | "right";
}

export function MobileSlideInPanel({
  className,
  children,
  isOpen,
  onClose,
  title,
  titleId,
  position = "right",
  ...props
}: MobileSlideInPanelProps) {
  const { t } = useTranslation();

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // The panel covers the screen on touch layouts, so Escape has to dismiss it
  // the way the backdrop and the close button do.
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // A dialog opened from inside the panel (export, confirmations) handles
      // Escape first and marks the event; closing the panel too would dismiss
      // both layers with one key press.
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={cn(
          "fixed inset-y-0 z-50 flex w-full max-w-[26rem] flex-col overflow-hidden bg-white dark:bg-dark-secondary shadow-xl transition-transform duration-300 ease-in-out safe-area-left safe-area-right",
          position === "right" && "right-0",
          position === "left" && "left-0",
          isOpen
            ? "translate-x-0"
            : position === "right"
              ? "translate-x-full"
              : "-translate-x-full",
          className,
        )}
        role="dialog"
        aria-modal={isOpen || undefined}
        aria-label={titleId ? undefined : title}
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        // Closed panels stay mounted for the slide transition; without `inert`
        // their links and inputs remain tabbable behind the chat view.
        inert={!isOpen}
        {...props}
      >
        {/* Panel Header - omitted when the content supplies its own chrome. */}
        {title && !titleId && (
          <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-gray-200 dark:border-dark-border bg-whatsapp-teal-green px-4 text-white safe-area-top">
            {onClose && (
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 transition-colors touch-manipulation"
                aria-label={t("common.closePanel", "Close panel")}
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {title && <h2 className="text-lg font-medium">{title}</h2>}
          </header>
        )}

        {/* Panel Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto safe-area-bottom">
          {children}
        </div>
      </aside>
    </>
  );
}

export interface MobileActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
}

export function MobileActionButton({
  className,
  icon,
  label,
  ...props
}: MobileActionButtonProps) {
  return (
    <button
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full text-gray-600 dark:text-dark-text-secondary hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation",
        className,
      )}
      aria-label={label}
      {...props}
    >
      {icon}
    </button>
  );
}

// Export all components
export { MobileLayoutContext };
