import * as React from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useClickOutside } from "@/hooks/ui";

export interface EllipsisMenuItem {
  /**
   * Unique identifier for the menu item
   */
  id: string;
  /**
   * Display label
   */
  label: string;
  /**
   * Optional icon component
   */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Click handler
   */
  onClick: () => void;
  /**
   * Whether this is a destructive action (red styling)
   * @default false
   */
  destructive?: boolean;
  /**
   * Whether the item is disabled
   * @default false
   */
  disabled?: boolean;
}

export interface EllipsisMenuProps {
  /**
   * Menu items to display
   */
  items: EllipsisMenuItem[];
  /**
   * Additional class name for the trigger button
   */
  triggerClassName?: string;
  /**
   * Additional class name for the menu dropdown
   */
  menuClassName?: string;
  /**
   * Size of the trigger button
   * @default "default"
   */
  size?: "sm" | "default";
  /**
   * Alignment of the dropdown menu
   * @default "right"
   */
  align?: "left" | "right";
  /**
   * Controlled open state
   */
  open?: boolean;
  /**
   * Callback when open state changes
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Aria label for the trigger button
   * @default "More options"
   */
  ariaLabel?: string;
}

/**
 * Reusable ellipsis (three dots) menu component
 *
 * @example
 * ```tsx
 * <EllipsisMenu
 *   items={[
 *     {
 *       id: "edit",
 *       label: "Edit",
 *       icon: Edit,
 *       onClick: handleEdit,
 *     },
 *     {
 *       id: "delete",
 *       label: "Delete",
 *       icon: Trash2,
 *       onClick: handleDelete,
 *       destructive: true,
 *     },
 *   ]}
 * />
 * ```
 */
export function EllipsisMenu({
  items,
  triggerClassName,
  menuClassName,
  size = "default",
  align = "right",
  open: controlledOpen,
  onOpenChange,
  ariaLabel = "More options",
}: EllipsisMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (open: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      onOpenChange?.(open);
    },
    [isControlled, onOpenChange],
  );

  const handleToggle = React.useCallback(() => {
    setOpen(!isOpen);
  }, [isOpen, setOpen]);

  const handleClose = React.useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleItemClick = React.useCallback(
    (item: EllipsisMenuItem) => {
      if (item.disabled) return;
      item.onClick();
      handleClose();
    },
    [handleClose],
  );

  // Close on click outside
  useClickOutside(containerRef, handleClose, { enabled: isOpen });

  // Keyboard navigation
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!isOpen) {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          setOpen(true);
        }
        return;
      }

      const menuItems = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      if (!menuItems?.length) return;

      const currentIndex = Array.from(menuItems).findIndex(
        (el) => el === document.activeElement,
      );

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (currentIndex < menuItems.length - 1) {
            menuItems[currentIndex + 1].focus();
          } else {
            menuItems[0].focus();
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          if (currentIndex > 0) {
            menuItems[currentIndex - 1].focus();
          } else {
            menuItems[menuItems.length - 1].focus();
          }
          break;
        case "Home":
          event.preventDefault();
          menuItems[0].focus();
          break;
        case "End":
          event.preventDefault();
          menuItems[menuItems.length - 1].focus();
          break;
        case "Escape":
          event.preventDefault();
          handleClose();
          break;
      }
    },
    [isOpen, setOpen, handleClose],
  );

  // Focus first item when menu opens
  React.useEffect(() => {
    if (isOpen) {
      const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      firstItem?.focus();
    }
  }, [isOpen]);

  const buttonSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(buttonSize, triggerClassName)}
      >
        <MoreVertical className={iconSize} />
      </Button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          className={cn(
            "absolute top-full z-50 mt-1 w-48 rounded-md border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-whatsapp-green focus:bg-gray-100 dark:focus:bg-dark-tertiary",
                  item.destructive
                    ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                    : "text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary",
                  item.disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
