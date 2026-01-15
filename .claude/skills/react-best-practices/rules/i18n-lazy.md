---
title: Lazy Load Translation Namespaces
impact: MEDIUM
impactDescription: reduces initial bundle size
tags: i18n, i18next, lazy, bundle
---

## Lazy Load Translation Namespaces

Load translation namespaces on demand to reduce initial bundle size.

**Incorrect (all translations in main bundle):**

```tsx
// i18n.ts
import i18n from 'i18next'
import common from './locales/en/common.json'
import dashboard from './locales/en/dashboard.json'
import settings from './locales/en/settings.json'
import admin from './locales/en/admin.json'
// ... 20 more namespaces

i18n.init({
  resources: {
    en: { common, dashboard, settings, admin /* ... */ },
  },
})
```

**Correct (lazy load with backend):**

```tsx
// i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    ns: ['common'], // Only load common initially
    defaultNS: 'common',
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
```

**Load namespace when route is accessed:**

```tsx
import { useTranslation } from 'react-i18next'

function SettingsPage() {
  // Loads 'settings' namespace on mount
  const { t, ready } = useTranslation('settings', { useSuspense: false })

  if (!ready) return <Skeleton />

  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </div>
  )
}
```

**With Suspense (cleaner):**

```tsx
// Wrap app in Suspense
function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Router />
    </Suspense>
  )
}

// Component suspends until translations load
function SettingsPage() {
  const { t } = useTranslation('settings') // Suspends if not loaded

  return <h1>{t('title')}</h1>
}
```

**Preload namespace on hover:**

```tsx
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

function NavLink() {
  const preloadSettings = () => {
    i18n.loadNamespaces('settings')
  }

  return (
    <Link
      to="/settings"
      onMouseEnter={preloadSettings}
      onFocus={preloadSettings}
    >
      Settings
    </Link>
  )
}
```

**Type-safe translations:**

```tsx
// types/i18next.d.ts
import 'i18next'
import common from '../locales/en/common.json'
import settings from '../locales/en/settings.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      settings: typeof settings
    }
  }
}

// Now t() is fully typed
const { t } = useTranslation('common')
t('nav.home') // TypeScript autocomplete works
```

**Vite plugin for namespace generation:**

```tsx
// vite.config.ts
export default defineConfig({
  plugins: [
    // Generate namespace chunks
    {
      name: 'i18n-chunks',
      config() {
        return {
          build: {
            rollupOptions: {
              output: {
                manualChunks(id) {
                  if (id.includes('/locales/')) {
                    const match = id.match(/locales\/(\w+)\/(\w+)\.json/)
                    if (match) return `locale-${match[1]}-${match[2]}`
                  }
                },
              },
            },
          },
        }
      },
    },
  ],
})
```

Reference: [i18next Lazy Loading](https://www.i18next.com/how-to/add-or-load-translations#lazy-load-in-memory-translations)
