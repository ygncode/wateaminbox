---
title: Lazy Load Route Components
impact: CRITICAL
impactDescription: reduces initial bundle size
tags: router, react-router, lazy, code-splitting
---

## Lazy Load Route Components

Use React.lazy for route-based code splitting to reduce initial bundle size.

**Incorrect (all routes in main bundle):**

```tsx
import { createBrowserRouter } from 'react-router'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Analytics from './pages/Analytics'

// All pages bundled together - large initial load
const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '/settings', element: <Settings /> },
  { path: '/profile', element: <Profile /> },
  { path: '/analytics', element: <Analytics /> },
])
```

**Correct (lazy loaded routes):**

```tsx
import { createBrowserRouter } from 'react-router'
import { lazy, Suspense } from 'react'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Profile = lazy(() => import('./pages/Profile'))
const Analytics = lazy(() => import('./pages/Analytics'))

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <Dashboard />
      </Suspense>
    ),
  },
  {
    path: '/settings',
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <Settings />
      </Suspense>
    ),
  },
  // ...
])
```

**Better: Wrapper component for cleaner routes:**

```tsx
// components/LazyRoute.tsx
import { Suspense, lazy, ComponentType } from 'react'

export function lazyRoute<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
) {
  const LazyComponent = lazy(importFn)

  return (
    <Suspense fallback={<PageSkeleton />}>
      <LazyComponent />
    </Suspense>
  )
}

// routes.tsx
const router = createBrowserRouter([
  { path: '/', element: lazyRoute(() => import('./pages/Dashboard')) },
  { path: '/settings', element: lazyRoute(() => import('./pages/Settings')) },
  { path: '/profile', element: lazyRoute(() => import('./pages/Profile')) },
])
```

**With React Router 7 lazy property:**

```tsx
const router = createBrowserRouter([
  {
    path: '/',
    lazy: () => import('./pages/Dashboard'),
  },
  {
    path: '/settings',
    lazy: () => import('./pages/Settings'),
  },
  {
    path: '/profile',
    lazy: async () => {
      const { Profile, profileLoader } = await import('./pages/Profile')
      return {
        Component: Profile,
        loader: profileLoader,
      }
    },
  },
])
```

**Vite magic comments for chunk naming:**

```tsx
const Dashboard = lazy(() =>
  import(/* webpackChunkName: "dashboard" */ './pages/Dashboard')
)

// Or with Vite's glob import for multiple routes
const pages = import.meta.glob('./pages/*.tsx')
```

Reference: [React Router Lazy Loading](https://reactrouter.com/en/main/route/lazy)
