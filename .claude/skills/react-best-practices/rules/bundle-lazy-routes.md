---
title: Use React.lazy for Route-Based Splitting
impact: CRITICAL
impactDescription: reduces initial bundle by 50-80%
tags: bundle, lazy, code-splitting, vite
---

## Use React.lazy for Route-Based Splitting

Split your bundle by routes using React.lazy and Suspense. Vite automatically creates separate chunks.

**Incorrect (all components in main bundle):**

```tsx
// All imports included in initial bundle
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Analytics from './pages/Analytics'
import Reports from './pages/Reports'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/reports" element={<Reports />} />
    </Routes>
  )
}
```

**Correct (lazy loaded routes):**

```tsx
import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'

// Each creates a separate chunk
const Home = lazy(() => import('./pages/Home'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Reports = lazy(() => import('./pages/Reports'))

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </Suspense>
  )
}
```

**Named exports with lazy:**

```tsx
// For named exports, use intermediate function
const UserProfile = lazy(() =>
  import('./pages/UserProfile').then(module => ({
    default: module.UserProfile,
  }))
)
```

**Vite-specific: Manual chunk naming:**

```tsx
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router'],
          'query': ['@tanstack/react-query'],
          'ui': ['@radix-ui/react-dialog', '@radix-ui/react-popover'],
        },
      },
    },
  },
})
```

**Preload on hover for instant navigation:**

```tsx
const Dashboard = lazy(() => import('./pages/Dashboard'))

// Preload function
const preloadDashboard = () => {
  import('./pages/Dashboard')
}

function NavLink() {
  return (
    <Link
      to="/dashboard"
      onMouseEnter={preloadDashboard}
      onFocus={preloadDashboard}
    >
      Dashboard
    </Link>
  )
}
```

**Analyze bundle with visualizer:**

```bash
# Install plugin
npm i -D rollup-plugin-visualizer

# vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    visualizer({
      open: true,
      gzipSize: true,
    }),
  ],
})
```
