import * as React from "react";
import { cn } from "@/lib/utils";

export type AriaLivePoliteness = "polite" | "assertive" | "off";

export interface AriaLiveProps {
  /** The politeness level for screen reader announcements */
  politeness?: AriaLivePoliteness;
  /** Content to be announced. When this changes, screen readers will announce it */
  children?: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
  /** Whether to clear the announcement after a delay (ms). Set to 0 to keep visible */
  clearAfter?: number;
  /** Whether the region should also be atomic (announce entire region on change) */
  atomic?: boolean;
  /** Whether the region is relevant for additions, removals, or all changes */
  relevant?: "additions" | "removals" | "text" | "all" | "additions text";
}

/**
 * ARIA Live Region component for screen reader announcements
 *
 * Use this component to announce dynamic content changes to screen readers.
 * The content is visually hidden but accessible to assistive technology.
 *
 * @example
 * // Polite announcement (waits for user to finish current task)
 * <AriaLive politeness="polite">
 *   {notificationMessage}
 * </AriaLive>
 *
 * @example
 * // Assertive announcement (interrupts immediately)
 * <AriaLive politeness="assertive">
 *   {errorMessage}
 * </AriaLive>
 */
export function AriaLive({
  politeness = "polite",
  children,
  className,
  atomic = true,
  relevant = "additions text",
}: AriaLiveProps) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic={atomic}
      aria-relevant={relevant}
      className={cn(
        // Visually hidden but accessible to screen readers
        "sr-only",
        className,
      )}
    >
      {children}
    </div>
  );
}

AriaLive.displayName = "AriaLive";

// ============================================================================
// useAnnounce Hook
// ============================================================================

interface AnnounceOptions {
  /** Politeness level for the announcement */
  politeness?: AriaLivePoliteness;
  /** Clear the announcement after this many milliseconds */
  clearAfter?: number;
}

interface UseAnnounceReturn {
  /** The current announcement message */
  message: string;
  /** Function to trigger an announcement */
  announce: (message: string, options?: AnnounceOptions) => void;
  /** Clear the current announcement */
  clear: () => void;
  /** The current politeness level */
  politeness: AriaLivePoliteness;
}

/**
 * Hook for imperative screen reader announcements
 *
 * Returns a message state and announce function that can be used
 * with the AriaLive component for dynamic announcements.
 *
 * @example
 * function MyComponent() {
 *   const { message, announce, politeness } = useAnnounce()
 *
 *   const handleSave = async () => {
 *     await saveData()
 *     announce("Changes saved successfully")
 *   }
 *
 *   return (
 *     <>
 *       <button onClick={handleSave}>Save</button>
 *       <AriaLive politeness={politeness}>{message}</AriaLive>
 *     </>
 *   )
 * }
 */
export function useAnnounce(
  defaultOptions: AnnounceOptions = {},
): UseAnnounceReturn {
  const [message, setMessage] = React.useState("");
  const [politeness, setPoliteness] = React.useState<AriaLivePoliteness>(
    defaultOptions.politeness ?? "polite",
  );
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback(() => {
    setMessage("");
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const announce = React.useCallback(
    (newMessage: string, options: AnnounceOptions = {}) => {
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const announcePoliteness =
        options.politeness ?? defaultOptions.politeness ?? "polite";
      const clearAfter =
        options.clearAfter ?? defaultOptions.clearAfter ?? 5000;

      setPoliteness(announcePoliteness);
      setMessage(newMessage);

      // Auto-clear after delay (default 5 seconds)
      if (clearAfter > 0) {
        timeoutRef.current = setTimeout(() => {
          setMessage("");
          timeoutRef.current = null;
        }, clearAfter);
      }
    },
    [defaultOptions.politeness, defaultOptions.clearAfter],
  );

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { message, announce, clear, politeness };
}

// ============================================================================
// AriaLiveAnnouncer - Global announcer component
// ============================================================================

interface AnnouncerContextValue {
  announce: (message: string, options?: AnnounceOptions) => void;
}

const AnnouncerContext = React.createContext<AnnouncerContextValue | null>(
  null,
);

export interface AriaLiveAnnouncerProps {
  children: React.ReactNode;
}

/**
 * Global announcer provider component
 *
 * Wrap your app with this component to enable global announcements
 * from anywhere in the component tree using useGlobalAnnounce().
 *
 * @example
 * // In your App.tsx or main.tsx
 * <AriaLiveAnnouncer>
 *   <App />
 * </AriaLiveAnnouncer>
 *
 * // In any component
 * const { announce } = useGlobalAnnounce()
 * announce("Item deleted")
 */
export function AriaLiveAnnouncer({ children }: AriaLiveAnnouncerProps) {
  const { message, announce, politeness } = useAnnounce();

  const contextValue = React.useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={contextValue}>
      {children}
      <AriaLive politeness={politeness}>{message}</AriaLive>
    </AnnouncerContext.Provider>
  );
}

AriaLiveAnnouncer.displayName = "AriaLiveAnnouncer";

/**
 * Hook to access the global announcer
 *
 * Must be used within an AriaLiveAnnouncer provider.
 *
 * @throws Error if used outside of AriaLiveAnnouncer
 */
export function useGlobalAnnounce(): AnnouncerContextValue {
  const context = React.useContext(AnnouncerContext);
  if (!context) {
    throw new Error("useGlobalAnnounce must be used within AriaLiveAnnouncer");
  }
  return context;
}
