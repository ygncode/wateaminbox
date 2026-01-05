import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/** Available theme options */
export type Theme = 'light' | 'dark' | 'system'

/** Resolved theme after applying system preference */
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  /** Current theme setting (light, dark, or system) */
  theme: Theme
  /** Resolved theme after applying system preference */
  resolvedTheme: ResolvedTheme
  /** Set the theme */
  setTheme: (theme: Theme) => void
  /** Toggle between light and dark (skips system) */
  toggleTheme: () => void
}

const STORAGE_KEY = 'whatsapp-web-theme'
const THEMES: Theme[] = ['light', 'dark', 'system']

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEMES.includes(stored as Theme)) {
      return stored as Theme
    }
  } catch {
    // localStorage not available (privacy mode, incognito)
  }
  return 'system'
}

function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // localStorage not available
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme()
  }
  return theme
}

function applyThemeToDOM(resolvedTheme: ResolvedTheme): void {
  const root = document.documentElement
  if (resolvedTheme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  // Update theme-color meta tag for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#111B21' : '#075E54')
  }
}

interface ThemeProviderProps {
  children: ReactNode
  /** Default theme if none stored */
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme()
    return stored || defaultTheme
  })

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme))

  // Handle theme changes
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    setStoredTheme(newTheme)
    const resolved = resolveTheme(newTheme)
    setResolvedTheme(resolved)
    applyThemeToDOM(resolved)

    // Announce theme change to screen readers
    const announcement = document.getElementById('theme-announcement')
    if (announcement) {
      const themeLabel =
        newTheme === 'system'
          ? `System (${resolved})`
          : newTheme.charAt(0).toUpperCase() + newTheme.slice(1)
      announcement.textContent = `Theme changed to ${themeLabel}`
    }
  }, [])

  // Toggle cycles through light → dark → system
  const toggleTheme = useCallback(() => {
    const currentIndex = THEMES.indexOf(theme)
    const nextIndex = (currentIndex + 1) % THEMES.length
    setTheme(THEMES[nextIndex])
  }, [theme, setTheme])

  // Apply theme on mount
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, [resolvedTheme])

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      if (theme === 'system') {
        const newResolved = getSystemTheme()
        setResolvedTheme(newResolved)
        applyThemeToDOM(newResolved)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
      {/* Screen reader announcement for theme changes */}
      <div
        id="theme-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
