---
title: Leverage React Compiler Automatic Optimization
impact: MEDIUM
impactDescription: removes need for manual memoization
tags: rerender, react-19, compiler, memo
---

## Leverage React Compiler Automatic Optimization

React 19's compiler automatically memoizes components and values. Remove manual memo/useMemo/useCallback when compiler is enabled.

**With React Compiler enabled, this is unnecessary:**

```tsx
// Before: Manual memoization everywhere
const UserCard = memo(function UserCard({ user }: { user: User }) {
  const formattedDate = useMemo(
    () => formatDate(user.createdAt),
    [user.createdAt]
  )

  const handleClick = useCallback(() => {
    trackClick(user.id)
  }, [user.id])

  return (
    <div onClick={handleClick}>
      <span>{user.name}</span>
      <span>{formattedDate}</span>
    </div>
  )
})
```

**With React Compiler - just write normal code:**

```tsx
// After: Compiler handles memoization automatically
function UserCard({ user }: { user: User }) {
  const formattedDate = formatDate(user.createdAt)

  const handleClick = () => {
    trackClick(user.id)
  }

  return (
    <div onClick={handleClick}>
      <span>{user.name}</span>
      <span>{formattedDate}</span>
    </div>
  )
}
```

**Enable React Compiler in Vite:**

```bash
npm install -D babel-plugin-react-compiler
```

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
  ],
})
```

**When manual memoization is still needed:**

```tsx
// 1. External library expectations
const MemoizedChart = memo(Chart) // If library expects stable reference

// 2. Expensive computations the compiler can't optimize
const expensiveResult = useMemo(() => {
  // Complex algorithm the compiler doesn't recognize
  return runExpensiveAlgorithm(data)
}, [data])

// 3. Stable identity for context values
const contextValue = useMemo(
  () => ({ user, updateUser }),
  [user, updateUser]
)
```

**Check if compiler is working:**

```tsx
// Add to vite.config.ts for debugging
react({
  babel: {
    plugins: [
      [
        'babel-plugin-react-compiler',
        {
          // Shows which components are optimized
          runtimeModule: 'react-compiler-runtime',
        },
      ],
    ],
  },
})
```

**Gradual adoption:**

```tsx
// Opt specific files out of compilation
// Add at top of file:
'use no memo';

function LegacyComponent() {
  // This component won't be auto-memoized
}
```

**Note:** React Compiler is production-ready as of React 19. If you're on an older version or have issues, continue using manual memoization.

Reference: [React Compiler](https://react.dev/learn/react-compiler)
