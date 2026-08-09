import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-dark-text-tertiary"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search tags…"
        aria-label="Search tags"
        autoFocus={autoFocus}
        className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-8 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-whatsapp-green focus:bg-white focus:ring-1 focus:ring-whatsapp-green/30 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary dark:focus:bg-dark-elevated"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear tag search"
          className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-gray-400 hover:bg-black/5 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/40 dark:text-dark-text-tertiary dark:hover:bg-white/10"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
