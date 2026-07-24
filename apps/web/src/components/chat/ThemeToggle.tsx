import { Monitor, Moon, Sun } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type Theme, useTheme } from "../../contexts";

const THEME_CONFIG: Record<
  Theme,
  { icon: typeof Sun; label: string; nextTheme: Theme }
> = {
  light: { icon: Sun, label: "Light", nextTheme: "dark" },
  dark: { icon: Moon, label: "Dark", nextTheme: "system" },
  system: { icon: Monitor, label: "Follow System", nextTheme: "light" },
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const config = THEME_CONFIG[theme];
  const Icon = config.icon;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid="theme-toggle"
            onClick={toggleTheme}
            className={cn(
              "flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 hover:text-gray-700 dark:text-dark-text-secondary dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation",
              className,
            )}
            aria-label={`Current theme: ${config.label}. Click to switch to ${THEME_CONFIG[config.nextTheme].label}`}
          >
            <Icon className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.label}</p>
        </TooltipContent>
      </Tooltip>

      {/* Screen reader announcement for theme changes */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        Theme changed to {config.label}
      </div>
    </>
  );
}

export default ThemeToggle;
