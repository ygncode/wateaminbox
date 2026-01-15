---
title: Organize Stores into Focused Slices
impact: HIGH
impactDescription: maintainable, scalable state
tags: state, zustand, slices, architecture
---

## Organize Stores into Focused Slices

Split large stores into domain-focused slices for better organization and testability.

**Incorrect (monolithic store):**

```tsx
const useStore = create<AppState>((set, get) => ({
  // Auth
  user: null,
  isAuthenticated: false,
  login: async (credentials) => { /* ... */ },
  logout: () => { /* ... */ },

  // UI
  theme: 'light',
  sidebarOpen: true,
  modals: {},
  setTheme: (theme) => { /* ... */ },
  toggleSidebar: () => { /* ... */ },
  openModal: (id) => { /* ... */ },
  closeModal: (id) => { /* ... */ },

  // Cart
  items: [],
  addToCart: (item) => { /* ... */ },
  removeFromCart: (id) => { /* ... */ },
  clearCart: () => { /* ... */ },

  // ... 50 more properties
}))
```

**Correct (slice pattern):**

```tsx
// stores/authSlice.ts
export interface AuthSlice {
  user: User | null
  isAuthenticated: boolean
  login: (credentials: Credentials) => Promise<void>
  logout: () => void
}

export const createAuthSlice: StateCreator<
  AppState,
  [],
  [],
  AuthSlice
> = (set, get) => ({
  user: null,
  isAuthenticated: false,

  login: async (credentials) => {
    const user = await authApi.login(credentials)
    set({ user, isAuthenticated: true })
  },

  logout: () => {
    set({ user: null, isAuthenticated: false })
    // Can access other slices via get()
    get().clearCart()
  },
})

// stores/uiSlice.ts
export interface UISlice {
  theme: Theme
  sidebarOpen: boolean
  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
}

export const createUISlice: StateCreator<
  AppState,
  [],
  [],
  UISlice
> = (set) => ({
  theme: 'light',
  sidebarOpen: true,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
})

// stores/cartSlice.ts
export interface CartSlice {
  items: CartItem[]
  addToCart: (item: CartItem) => void
  removeFromCart: (id: string) => void
  clearCart: () => void
}

export const createCartSlice: StateCreator<
  AppState,
  [],
  [],
  CartSlice
> = (set) => ({
  items: [],

  addToCart: (item) => set((s) => ({
    items: [...s.items, item]
  })),

  removeFromCart: (id) => set((s) => ({
    items: s.items.filter(i => i.id !== id)
  })),

  clearCart: () => set({ items: [] }),
})

// stores/index.ts
export type AppState = AuthSlice & UISlice & CartSlice

export const useStore = create<AppState>()((...args) => ({
  ...createAuthSlice(...args),
  ...createUISlice(...args),
  ...createCartSlice(...args),
}))
```

**With middleware (persist, devtools):**

```tsx
import { devtools, persist } from 'zustand/middleware'

export const useStore = create<AppState>()(
  devtools(
    persist(
      (...args) => ({
        ...createAuthSlice(...args),
        ...createUISlice(...args),
        ...createCartSlice(...args),
      }),
      {
        name: 'app-storage',
        partialize: (state) => ({
          // Only persist these slices
          theme: state.theme,
          items: state.items,
        }),
      }
    ),
    { name: 'AppStore' }
  )
)
```

Reference: [Zustand Slices Pattern](https://zustand.docs.pmnd.rs/guides/slices-pattern)
