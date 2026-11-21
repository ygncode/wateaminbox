import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface TagSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

export function TagSearchInput({
  value,
  onChange,
  className,
  autoFocus = false,
}: TagSearchInputProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("tags.searchPlaceholder", "Search tags…")}
        aria-label={t("tags.search", "Search tags")}
        autoFocus={autoFocus}
        className="h-8 w-full rounded-lg border border-line bg-muted py-1.5 ps-8 pe-8 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary focus:bg-surface focus:ring-1 focus:ring-ring/30"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("tags.clearSearch", "Clear tag search")}
          className="absolute end-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:bg-fg/5 hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
