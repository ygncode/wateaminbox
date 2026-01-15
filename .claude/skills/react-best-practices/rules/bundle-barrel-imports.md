---
title: Import Directly, Avoid Barrel Files
impact: CRITICAL
impactDescription: prevents unnecessary code inclusion
tags: bundle, imports, tree-shaking, vite
---

## Import Directly, Avoid Barrel Files

Import from specific files instead of barrel files (index.ts) to enable proper tree-shaking.

**Incorrect (barrel import pulls entire module):**

```tsx
// components/index.ts (barrel file)
export { Button } from './Button'
export { Input } from './Input'
export { Dialog } from './Dialog'
export { DataTable } from './DataTable'  // Heavy component
export { Chart } from './Chart'           // Heavy component
export { Editor } from './Editor'         // Heavy component

// Usage - may pull in ALL exports depending on bundler
import { Button } from '@/components'
```

**Correct (direct imports):**

```tsx
// Import exactly what you need
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
```

**If you must use barrels, configure Vite:**

```tsx
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: {
      // Direct path aliases skip barrel files
      '@/components/Button': '/src/components/Button.tsx',
      '@/components/Input': '/src/components/Input.tsx',
    },
  },
  optimizeDeps: {
    // Force pre-bundling to resolve barrel exports
    include: ['@/components'],
  },
})
```

**Better: Co-locate exports with components:**

```tsx
// Instead of central barrel:
// components/
//   index.ts        <- barrel (avoid)
//   Button.tsx
//   Input.tsx

// Use direct imports:
// components/
//   Button/
//     index.tsx     <- single component export
//     Button.tsx
//     Button.test.tsx
//   Input/
//     index.tsx
//     Input.tsx
```

**For third-party libraries:**

```tsx
// Incorrect - may import entire library
import { format } from 'date-fns'

// Correct - import specific function
import format from 'date-fns/format'

// For Lodash
import { debounce } from 'lodash'      // Imports all of lodash
import debounce from 'lodash/debounce' // Imports only debounce
```

**Check bundle impact:**

```bash
# Add to package.json scripts
"analyze": "vite build --mode analyze"

# Or use source-map-explorer
npx source-map-explorer dist/assets/*.js
```

**Icon libraries (common issue):**

```tsx
// Incorrect - may bundle all icons
import { Home, Settings, User } from 'lucide-react'

// Lucide-react is tree-shakeable, but verify with bundle analyzer
// If issues, import directly:
import Home from 'lucide-react/dist/esm/icons/home'
```
