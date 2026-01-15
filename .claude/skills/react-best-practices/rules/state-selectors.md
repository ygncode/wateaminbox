---
title: Use Selectors to Prevent Re-renders
impact: HIGH
impactDescription: prevents unnecessary component updates
tags: state, zustand, selectors, rerender
---

## Use Selectors to Prevent Re-renders

Select only the state slices your component needs. Components re-render when their selected state changes.

**Incorrect (subscribes to entire store):**

```tsx
const useStore = create<AppState>((set) => ({
  user: null,
  theme: 'light',
  notifications: [],
  setUser: (user) => set({ user }),
  setTheme: (theme) => set({ theme }),
  addNotification: (n) => set((s) => ({
    notifications: [...s.notifications, n]
  })),
}))

function Header() {
  // Re-renders when ANY state changes
  const store = useStore()

  return <div>Welcome, {store.user?.name}</div>
}
```

**Correct (select specific state):**

```tsx
function Header() {
  // Only re-renders when user changes
  const user = useStore((state) => state.user)

  return <div>Welcome, {user?.name}</div>
}

function ThemeToggle() {
  // Only re-renders when theme changes
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)

  return (
    <Button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      {theme}
    </Button>
  )
}
```

**Multiple selections with shallow equality:**

```tsx
import { useShallow } from 'zustand/shallow'

function UserPanel() {
  // Re-renders only when user OR notifications change
  const { user, notifications } = useStore(
    useShallow((state) => ({
      user: state.user,
      notifications: state.notifications,
    }))
  )

  return (
    <div>
      <span>{user?.name}</span>
      <Badge>{notifications.length}</Badge>
    </div>
  )
}
```

**Derived selectors for computed values:**

```tsx
// selectors.ts
export const selectUnreadCount = (state: AppState) =>
  state.notifications.filter(n => !n.read).length

export const selectIsAdmin = (state: AppState) =>
  state.user?.role === 'admin'

// Component
function NotificationBadge() {
  const unreadCount = useStore(selectUnreadCount)
  return <Badge>{unreadCount}</Badge>
}
```

**Actions don't need selectors (stable references):**

```tsx
function NotificationList() {
  const notifications = useStore((state) => state.notifications)
  // Actions are stable - selecting them doesn't cause re-renders
  const markAsRead = useStore((state) => state.markAsRead)

  return (
    <ul>
      {notifications.map(n => (
        <li key={n.id} onClick={() => markAsRead(n.id)}>
          {n.message}
        </li>
      ))}
    </ul>
  )
}
```

Reference: [Zustand Auto Generating Selectors](https://zustand.docs.pmnd.rs/guides/auto-generating-selectors)
