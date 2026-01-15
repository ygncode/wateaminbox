---
title: Implement Dark Mode with Tailwind 4
impact: MEDIUM
impactDescription: accessible theming with no flash
tags: ui, tailwind, dark-mode, theming
---

## Implement Dark Mode with Tailwind 4

Implement dark mode using Tailwind CSS 4's built-in dark mode support with system preference detection.

**Basic setup with class strategy:**

```tsx
// tailwind.config.ts (Tailwind 4 uses CSS-based config)
// Or in your CSS:

/* styles.css */
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* Or use media query strategy */
@custom-variant dark (@media (prefers-color-scheme: dark));
```

**Theme provider with Zustand:**

```tsx
// stores/theme.ts
type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'theme' }
  )
)

// hooks/useTheme.ts
export function useTheme() {
  const { theme, setTheme } = useThemeStore()

  useEffect(() => {
    const root = document.documentElement

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      root.classList.toggle('dark', systemTheme === 'dark')
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches)
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}
```

**Prevent flash of wrong theme:**

```html
<!-- index.html - inline script runs before React -->
<script>
  (function() {
    const stored = localStorage.getItem('theme')
    const theme = stored ? JSON.parse(stored).state?.theme : 'system'

    if (theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    }
  })()
</script>
```

**Theme toggle component:**

```tsx
import { Moon, Sun, Monitor } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon">
          <Icon className="h-5 w-5" />
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1">
        <DropdownMenu.Item
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onSelect={() => setTheme('light')}
        >
          <Sun className="h-4 w-4" /> Light
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onSelect={() => setTheme('dark')}
        >
          <Moon className="h-4 w-4" /> Dark
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onSelect={() => setTheme('system')}
        >
          <Monitor className="h-4 w-4" /> System
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
```

**Component styling patterns:**

```tsx
// Use dark: variant for dark mode styles
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm dark:shadow-gray-900/20">
      {children}
    </div>
  )
}

// CSS variables for semantic colors
/* styles.css */
:root {
  --color-bg: theme(colors.white);
  --color-text: theme(colors.gray.900);
  --color-border: theme(colors.gray.200);
}

.dark {
  --color-bg: theme(colors.gray.900);
  --color-text: theme(colors.gray.100);
  --color-border: theme(colors.gray.700);
}

// Then use variables
function Card() {
  return (
    <div className="bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* ... */}
    </div>
  )
}
```

Reference: [Tailwind CSS Dark Mode](https://tailwindcss.com/docs/dark-mode)
