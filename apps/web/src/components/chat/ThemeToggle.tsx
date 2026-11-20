import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThemeIcon, themeLabel } from "@/components/settings/ThemePicker";
import { useTheme } from "@/contexts";
import { THEME_PREFERENCES } from "@/lib/theme/themes";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

/** Compact theme menu for the navigation rail and mobile header. */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="theme-toggle"
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-colors touch-manipulation md:h-10 md:w-10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={t("settings.themeMenuAria", {
            defaultValue: "Theme: {{current}}",
            current: themeLabel(t, theme),
          })}
        >
          <ThemeIcon theme={theme} className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-48 p-1" role="menu">
        {THEME_PREFERENCES.map((id) => (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={theme === id}
            onClick={() => {
              setTheme(id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <ThemeIcon theme={id} className="size-4 text-fg-muted" />
            <span className="flex-1 text-start">{themeLabel(t, id)}</span>
            {theme === id && <Check className="size-4" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
