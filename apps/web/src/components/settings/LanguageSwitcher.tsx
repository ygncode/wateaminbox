import { Globe } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type LanguageCode, languages, saveLanguage } from '@/lib/i18n'

interface LanguageSwitcherProps {
  /** Optional class name for styling */
  className?: string
  /** Show label next to the switcher */
  showLabel?: boolean
}

/**
 * Language switcher dropdown component
 * Allows users to change the application language
 * Persists the language choice to localStorage
 */
export function LanguageSwitcher({ className, showLabel = true }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation()

  const handleLanguageChange = useCallback(
    (value: string) => {
      const languageCode = value as LanguageCode
      i18n.changeLanguage(languageCode)
      saveLanguage(languageCode)
    },
    [i18n]
  )

  return (
    <div className={`flex items-center gap-3 ${className || ''}`}>
      {showLabel && (
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-text-secondary">
          <Globe className="h-4 w-4" />
          <span>{t('settings.language')}</span>
        </div>
      )}
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('settings.language')} />
        </SelectTrigger>
        <SelectContent>
          {languages.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default LanguageSwitcher
