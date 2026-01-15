# Sections

This file defines all sections, their ordering, impact levels, and descriptions.
The section ID (in parentheses) is the filename prefix used to group rules.

---

## 1. Data Fetching with TanStack Query (query)

**Impact:** CRITICAL
**Description:** Proper data fetching patterns eliminate waterfalls, enable caching, and provide optimistic updates. TanStack Query v5 patterns are essential for responsive UIs.

## 2. Bundle Size Optimization (bundle)

**Impact:** CRITICAL
**Description:** Reducing initial bundle size improves Time to Interactive and Largest Contentful Paint. Vite's code splitting and tree shaking must be leveraged correctly.

## 3. State Management with Zustand (state)

**Impact:** HIGH
**Description:** Zustand v5 patterns for avoiding unnecessary re-renders, organizing stores, and handling persistence correctly.

## 4. React Router 7 Patterns (router)

**Impact:** HIGH
**Description:** Modern routing patterns including loaders, actions, lazy routes, and proper error handling.

## 5. Re-render Optimization (rerender)

**Impact:** MEDIUM
**Description:** Reducing unnecessary re-renders minimizes wasted computation and improves UI responsiveness. React 19 and React Compiler change some traditional patterns.

## 6. Forms with React Hook Form + Zod (form)

**Impact:** MEDIUM
**Description:** Type-safe form validation patterns that minimize re-renders and provide excellent UX.

## 7. UI Components with Radix + Tailwind (ui)

**Impact:** MEDIUM
**Description:** Composing accessible Radix primitives with Tailwind CSS 4 for maintainable component libraries.

## 8. Rendering Performance (rendering)

**Impact:** MEDIUM
**Description:** Optimizing the rendering process with virtualization, content-visibility, and efficient JSX patterns.

## 9. JavaScript Performance (js)

**Impact:** LOW-MEDIUM
**Description:** Micro-optimizations for hot paths that can add up to meaningful improvements.
