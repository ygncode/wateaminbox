import { useMemo } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatShortcut,
  isMac,
  type KeyboardShortcut,
} from "@/hooks/useKeyboardShortcuts";
import { useKeyboardShortcutsContext } from "@/contexts/KeyboardShortcutsContext";

/**
 * Category configuration for grouping shortcuts
 */
interface ShortcutCategory {
  id: "navigation" | "chat" | "general";
  label: string;
  description: string;
}

const categories: ShortcutCategory[] = [
  {
    id: "navigation",
    label: "Navigation",
    description: "Move around the application",
  },
  {
    id: "chat",
    label: "Chat",
    description: "Manage conversations and messages",
  },
  {
    id: "general",
    label: "General",
    description: "General application shortcuts",
  },
];

/**
 * Individual shortcut display component
 */
function ShortcutItem({ shortcut }: { shortcut: KeyboardShortcut }) {
  const formattedKeys = formatShortcut(shortcut);

  return (
    <div className="flex items-center justify-between py-2 px-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{shortcut.label}</p>
        <p className="text-xs text-gray-500 truncate">{shortcut.description}</p>
      </div>
      <div className="flex-shrink-0 ml-4">
        <kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded shadow-sm">
          {formattedKeys}
        </kbd>
      </div>
    </div>
  );
}

/**
 * Shortcut category section component
 */
function ShortcutSection({
  category,
  shortcuts,
}: {
  category: ShortcutCategory;
  shortcuts: KeyboardShortcut[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        {category.label}
      </h3>
      <p className="text-xs text-gray-500 mb-3">{category.description}</p>
      <div className="divide-y divide-gray-100">
        {shortcuts.map((shortcut) => (
          <ShortcutItem key={shortcut.id} shortcut={shortcut} />
        ))}
      </div>
    </div>
  );
}

export interface KeyboardShortcutsModalProps {
  /** Whether the modal is open */
  open?: boolean;
  /** Callback when the modal should close */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Modal component displaying all available keyboard shortcuts
 * Groups shortcuts by category (Navigation, Chat, General)
 * Shows platform-specific modifier keys (Cmd on Mac, Ctrl on Windows/Linux)
 */
export function KeyboardShortcutsModal({
  open,
  onOpenChange,
}: KeyboardShortcutsModalProps) {
  const { isHelpModalOpen, closeHelpModal, shortcuts } =
    useKeyboardShortcutsContext();

  // Use props if provided, otherwise use context
  const isOpen = open ?? isHelpModalOpen;
  const handleOpenChange =
    onOpenChange ??
    ((value: boolean) => {
      if (!value) closeHelpModal();
    });

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    const groups = new Map<string, KeyboardShortcut[]>();

    for (const category of categories) {
      groups.set(category.id, []);
    }

    for (const shortcut of shortcuts) {
      const categoryShortcuts = groups.get(shortcut.category) || [];
      categoryShortcuts.push(shortcut);
      groups.set(shortcut.category, categoryShortcuts);
    }

    return groups;
  }, [shortcuts]);

  const platformHint = isMac()
    ? "On Mac, use Cmd instead of Ctrl"
    : "On Windows/Linux, use Ctrl";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>{platformHint}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="py-2">
            {categories.map((category) => {
              const categoryShortcuts = groupedShortcuts.get(category.id) || [];
              return (
                <ShortcutSection
                  key={category.id}
                  category={category}
                  shortcuts={categoryShortcuts}
                />
              );
            })}
          </div>
        </ScrollArea>

        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Press{" "}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-gray-100 border border-gray-300 rounded">
              Esc
            </kbd>{" "}
            to close this dialog
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcutsModal;
