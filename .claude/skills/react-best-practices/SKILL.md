---
name: react-vite-stack
description: Best practices for React 19 + Vite SPA applications. Use when writing, reviewing, or optimizing React code with TanStack Query, Zustand, React Router 7, React Hook Form, Radix UI, and Tailwind CSS 4.
---

# React 19 + Vite Stack Best Practices

Performance optimization and architectural patterns for modern React SPAs built with:

- **React 19** (use(), Actions, useOptimistic, React Compiler)
- **Vite 6** (build, code splitting, HMR)
- **TanStack Query 5** (data fetching, caching)
- **TanStack Virtual 3** (virtualized lists)
- **Zustand 5** (state management)
- **React Router 7** (routing, data loading)
- **React Hook Form 7 + Zod 3** (forms, validation)
- **Radix UI + Tailwind CSS 4** (components, styling)
- **i18next** (internationalization)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Data Fetching | CRITICAL | `query-` |
| 2 | Bundle Optimization | CRITICAL | `bundle-` |
| 3 | State Management | HIGH | `state-` |
| 4 | Routing | HIGH | `router-` |
| 5 | Re-render Optimization | MEDIUM | `rerender-` |
| 6 | Forms & Validation | MEDIUM | `form-` |
| 7 | UI Components | MEDIUM | `ui-` |
| 8 | Rendering Performance | MEDIUM | `rendering-` |
| 9 | JavaScript Performance | LOW-MEDIUM | `js-` |

## Quick Reference

### 1. Data Fetching with TanStack Query (CRITICAL)

- `query-keys` - Structure query keys for cache invalidation
- `query-prefetch` - Prefetch on hover/route for instant navigation
- `query-parallel` - Use useQueries for parallel independent fetches
- `query-dependent` - Chain dependent queries with enabled option
- `query-optimistic` - Use optimistic updates for mutations
- `query-infinite` - Use useInfiniteQuery for paginated data
- `query-suspense` - Use useSuspenseQuery with React 19 Suspense

### 2. Bundle Size Optimization (CRITICAL)

- `bundle-barrel-imports` - Import directly, avoid barrel files
- `bundle-lazy-routes` - Use React.lazy for route-based splitting
- `bundle-defer-third-party` - Load analytics after hydration
- `bundle-conditional` - Load modules only when feature is activated
- `bundle-preload` - Preload on hover/focus for perceived speed
- `bundle-tree-shaking` - Configure Vite for optimal tree shaking

### 3. State Management with Zustand (HIGH)

- `state-slices` - Organize stores into focused slices
- `state-selectors` - Use selectors to prevent re-renders
- `state-actions` - Keep actions outside component scope
- `state-persist` - Use persist middleware correctly
- `state-devtools` - Enable devtools in development
- `state-immer` - Use immer for complex nested updates

### 4. React Router 7 Patterns (HIGH)

- `router-lazy` - Lazy load route components
- `router-loaders` - Use loaders for data prefetching
- `router-actions` - Use actions for mutations
- `router-error-boundary` - Handle route errors gracefully
- `router-pending-ui` - Show pending states during navigation

### 5. Re-render Optimization (MEDIUM)

- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-dependencies` - Use primitive dependencies in effects
- `rerender-derived-state` - Subscribe to derived booleans, not raw values
- `rerender-functional-setstate` - Use functional setState for stable callbacks
- `rerender-lazy-state-init` - Pass function to useState for expensive values
- `rerender-transitions` - Use startTransition for non-urgent updates
- `rerender-compiler` - Leverage React Compiler automatic optimization

### 6. Forms with React Hook Form + Zod (MEDIUM)

- `form-schema` - Define Zod schemas for type-safe validation
- `form-controlled` - Use Controller for complex inputs
- `form-arrays` - Use useFieldArray for dynamic lists
- `form-watch` - Use watch sparingly to avoid re-renders
- `form-submit` - Handle async submission with TanStack Query
- `form-errors` - Display validation errors accessibly

### 7. UI Components with Radix + Tailwind (MEDIUM)

- `ui-composition` - Compose Radix primitives with Tailwind
- `ui-variants` - Use CVA or class-variance-authority for variants
- `ui-accessibility` - Preserve Radix accessibility features
- `ui-animations` - Use Tailwind transitions with Radix states
- `ui-dark-mode` - Implement dark mode with Tailwind

### 8. Rendering Performance (MEDIUM)

- `rendering-virtual` - Use TanStack Virtual for long lists
- `rendering-content-visibility` - Use content-visibility for offscreen
- `rendering-hoist-jsx` - Extract static JSX outside components
- `rendering-svg-precision` - Reduce SVG coordinate precision
- `rendering-conditional` - Use ternary, not && for conditionals

### 9. JavaScript Performance (LOW-MEDIUM)

- `js-batch-dom-css` - Group CSS changes via classes or cssText
- `js-index-maps` - Build Map for repeated lookups
- `js-cache-property-access` - Cache object properties in loops
- `js-combine-iterations` - Combine multiple filter/map into one loop
- `js-early-exit` - Return early from functions
- `js-set-map-lookups` - Use Set/Map for O(1) lookups

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/query-keys.md
rules/state-selectors.md
rules/bundle-lazy-routes.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references
