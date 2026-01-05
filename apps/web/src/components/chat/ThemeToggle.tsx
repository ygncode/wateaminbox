import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type Theme } from '../../contexts'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui'

const THEME_CONFIG: Record<
  Theme,
  { icon: typeof Sun; label: string; nextTheme: Theme }
> = {
  light: { icon: Sun, label: 'Light', nextTheme: 'dark' },
  dark: { icon: Moon, label: 'Dark', nextTheme: 'system' },
  system: { icon: Monitor, label: 'Follow System', nextTheme: 'light' },
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const config = THEME_CONFIG[theme]
  const Icon = config.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggleTheme}
          className="flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 hover:text-gray-700 dark:text-dark-text-secondary dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
          aria-label={`Current theme: ${config.label}. Click to switch to ${THEME_CONFIG[config.nextTheme].label}`}
        >
          <Icon className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{config.label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default ThemeToggle
