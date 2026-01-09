import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | undefined>(
  undefined,
);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

export interface TabsProps {
  /**
   * The controlled value of the tab to activate
   */
  value?: string;
  /**
   * The value of the tab that should be active when initially rendered (uncontrolled)
   */
  defaultValue?: string;
  /**
   * Event handler called when the value changes
   */
  onValueChange?: (value: string) => void;
  /**
   * The content (TabsList and TabsContent components)
   */
  children: React.ReactNode;
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * Tabs component for organizing content into separate views
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="members">
 *   <TabsList>
 *     <TabsTrigger value="members">Members</TabsTrigger>
 *     <TabsTrigger value="invitations">Invitations</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="members">
 *     <MembersList />
 *   </TabsContent>
 *   <TabsContent value="invitations">
 *     <InvitationsList />
 *   </TabsContent>
 * </Tabs>
 * ```
 */
export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    defaultValue ?? "",
  );

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange],
  );

  const contextValue = React.useMemo(
    () => ({
      value,
      onValueChange: handleValueChange,
    }),
    [value, handleValueChange],
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Container for tab triggers
 */
export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex border-b border-gray-200 dark:border-dark-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  /**
   * Unique value for this tab
   */
  value: string;
  /**
   * Tab content (typically text and optional icon)
   */
  children: React.ReactNode;
  /**
   * Whether the tab is disabled
   */
  disabled?: boolean;
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * Tab trigger button
 */
export function TabsTrigger({
  value,
  children,
  disabled = false,
  className,
}: TabsTriggerProps) {
  const { value: selectedValue, onValueChange } = useTabsContext();
  const isSelected = selectedValue === value;
  const tabRef = React.useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (!disabled) {
      onValueChange(value);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    const tabList = tabRef.current?.parentElement;
    if (!tabList) return;

    const tabs = Array.from(
      tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    const currentIndex = tabs.findIndex((tab) => tab === tabRef.current);

    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        break;
      case "ArrowRight":
        event.preventDefault();
        nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        break;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        event.preventDefault();
        nextIndex = tabs.length - 1;
        break;
    }

    if (nextIndex !== null && tabs[nextIndex]) {
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    }
  };

  return (
    <button
      ref={tabRef}
      role="tab"
      type="button"
      aria-selected={isSelected}
      aria-controls={`tabpanel-${value}`}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-teal-green focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark-secondary",
        isSelected
          ? "border-b-2 border-whatsapp-teal-green text-whatsapp-teal-green"
          : "text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  /**
   * Value that matches the tab trigger value
   */
  value: string;
  /**
   * Content to display when tab is active
   */
  children: React.ReactNode;
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * Content panel for a tab
 */
export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: selectedValue } = useTabsContext();
  const isSelected = selectedValue === value;

  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className={cn("focus:outline-none", className)}
    >
      {children}
    </div>
  );
}
