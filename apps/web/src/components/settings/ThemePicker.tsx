import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { type Theme, useTheme } from "@/contexts";
import { cn } from "@/lib/utils";
import { THEME_PREFERENCES, type ThemeId } from "@/lib/theme/themes";

/** Fallback labels; translated values live under settings.themePanel.<id>. */
const LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
  whatsapp: "WhatsApp",
};

const ICONS: Partial<Record<Theme, ComponentType<{ className?: string }>>> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function themeLabel(t: (k: string, d: string) => string, id: Theme) {
  return t(`settings.themePanel.${id}Label`, LABELS[id]);
}

export function ThemeIcon({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  const Icon = ICONS[theme];
  if (Icon) return <Icon className={className} />;
  return <WhatsAppGlyph className={className} />;
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M20 11.6a8 8 0 0 1-11.9 7l-4.1 1.2 1.2-4A8 8 0 1 1 20 11.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A miniature of the inbox rendered *inside* the theme it previews, so each
 * card shows real token values instead of a hand-maintained swatch.
 */
function ThemePreview({ id }: { id: ThemeId }) {
  return (
    <div
      data-theme={id}
      className="flex h-full w-full overflow-hidden bg-canvas"
      aria-hidden
    >
      <div className="w-[22%] bg-nav" />
      <div className="flex w-[34%] flex-col gap-1.5 border-e border-line bg-surface p-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="size-2.5 shrink-0 rounded-full bg-muted-strong" />
            <span className="h-1 flex-1 rounded-full bg-muted" />
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1 bg-chat p-1.5">
        <span className="h-2.5 w-3/5 rounded-[4px] bg-bubble-in shadow-xs" />
        <span className="h-2.5 w-1/2 self-end rounded-[4px] bg-bubble-out" />
        <span className="mt-0.5 h-2 w-full rounded-full bg-field ring-1 ring-line" />
      </div>
    </div>
  );
}

function SystemPreview() {
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0">
        <ThemePreview id="light" />
      </div>
      <div className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
        <ThemePreview id="dark" />
      </div>
    </div>
  );
}

/** Settings > Appearance: a card per theme. */
export function ThemePicker() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.themePanel.title", "Theme")}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {THEME_PREFERENCES.map((id) => {
        const selected = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(id)}
            className={cn(
              "group rounded-xl text-start outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            )}
          >
            <span
              className={cn(
                "block aspect-[16/10] overflow-hidden rounded-xl ring-1 transition-shadow",
                selected
                  ? "ring-2 ring-primary"
                  : "ring-line group-hover:ring-line-strong",
              )}
            >
              {id === "system" ? <SystemPreview /> : <ThemePreview id={id} />}
            </span>
            <span className="mt-2 flex items-center gap-1.5 px-0.5 text-sm font-medium text-fg">
              {selected ? (
                <Check className="size-3.5" />
              ) : (
                <ThemeIcon theme={id} className="size-3.5 text-fg-subtle" />
              )}
              {themeLabel(t, id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
