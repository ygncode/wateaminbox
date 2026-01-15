---
title: Use Immer for Complex Nested Updates
impact: MEDIUM
impactDescription: cleaner mutation syntax
tags: state, zustand, immer, nested
---

## Use Immer for Complex Nested Updates

Use the immer middleware for readable nested state updates without manual spreading.

**Incorrect (manual spreading for nested updates):**

```tsx
const useStore = create<State>((set) => ({
  users: {
    byId: {},
    allIds: [],
  },

  updateUserProfile: (userId, updates) => set((state) => ({
    users: {
      ...state.users,
      byId: {
        ...state.users.byId,
        [userId]: {
          ...state.users.byId[userId],
          profile: {
            ...state.users.byId[userId].profile,
            ...updates,
          },
        },
      },
    },
  })),
}))
```

**Correct (immer middleware):**

```tsx
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

const useStore = create<State>()(
  immer((set) => ({
    users: {
      byId: {},
      allIds: [],
    },

    updateUserProfile: (userId, updates) => set((state) => {
      // Direct mutation - immer handles immutability
      Object.assign(state.users.byId[userId].profile, updates)
    }),

    addUser: (user) => set((state) => {
      state.users.byId[user.id] = user
      state.users.allIds.push(user.id)
    }),

    removeUser: (userId) => set((state) => {
      delete state.users.byId[userId]
      const index = state.users.allIds.indexOf(userId)
      if (index > -1) {
        state.users.allIds.splice(index, 1)
      }
    }),
  }))
)
```

**Combining with other middleware:**

```tsx
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

const useStore = create<State>()(
  devtools(
    persist(
      immer((set) => ({
        // Store definition with immer syntax
        items: [],
        addItem: (item) => set((state) => {
          state.items.push(item)
        }),
      })),
      { name: 'store' }
    ),
    { name: 'Store' }
  )
)
```

**When to use immer:**

- Deeply nested state (3+ levels)
- Array operations (push, splice, filter in place)
- Multiple properties updated together
- Complex conditional updates

**When NOT to use immer:**

- Simple flat state
- Single property updates
- Performance-critical hot paths (immer has small overhead)

```tsx
// Simple state - no immer needed
const useSimpleStore = create<SimpleState>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))
```
