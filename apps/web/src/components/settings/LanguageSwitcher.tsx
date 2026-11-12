import { Globe } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { type LanguageCode, languages, saveLanguage } from "@/lib/i18n";

interface LanguageSwitcherProps {
  /** Optional class name for styling */
  className?: string;
  /** Show label next to the switcher */
  showLabel?: boolean;
}

/**
 * Language switcher dropdown component.
 *
 * Switches immediately, remembers the choice in this browser, and saves it on
 * the signed-in account so the same language is used on every device.
 */
export function LanguageSwitcher({
  className,
  showLabel = true,
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const { user, updateProfile } = useAuth();

  const handleLanguageChange = useCallback(
    (value: string) => {
      const languageCode = value as LanguageCode;
      void i18n.changeLanguage(languageCode);
      saveLanguage(languageCode);
      if (!user || user.preferredLanguage === languageCode) return;
      updateProfile({ preferredLanguage: languageCode }).catch(() => {
        // The switch already applied in this browser; only saving it to the
        // account failed, so other devices keep their current language.
        toast.error(t("settings.languageSaveFailed"));
      });
    },
    [i18n, t, user, updateProfile],
  );

  return (
    <div className={`flex items-center gap-3 ${className || ""}`}>
      {showLabel && (
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-text-secondary">
          <Globe className="h-4 w-4" />
          <span>{t("settings.language")}</span>
        </div>
      )}
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t("settings.language")} />
        </SelectTrigger>
        <SelectContent>
          {languages.map((language) => (
            <SelectItem
              key={language.code}
              value={language.code}
              lang={language.code}
            >
              {language.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
