---
title: Use Set/Map for O(1) Lookups
impact: LOW-MEDIUM
impactDescription: faster lookups in hot paths
tags: js, performance, set, map
---

## Use Set/Map for O(1) Lookups

Replace array `.includes()` and `.find()` with Set/Map for repeated lookups.

**Incorrect (O(n) lookup each time):**

```tsx
function UserList({ users, selectedIds }: Props) {
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          {/* O(n) lookup for each of n users = O(n²) */}
          <Checkbox checked={selectedIds.includes(user.id)} />
          {user.name}
        </li>
      ))}
    </ul>
  )
}

// Or with find
function getUser(users: User[], id: string) {
  return users.find(u => u.id === id) // O(n)
}
```

**Correct (O(1) lookup):**

```tsx
function UserList({ users, selectedIds }: Props) {
  // Convert once, lookup many times
  const selectedSet = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  )

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          {/* O(1) lookup */}
          <Checkbox checked={selectedSet.has(user.id)} />
          {user.name}
        </li>
      ))}
    </ul>
  )
}

// With Map for object lookups
function UserList({ users }: Props) {
  const userMap = useMemo(
    () => new Map(users.map(u => [u.id, u])),
    [users]
  )

  const getUser = (id: string) => userMap.get(id) // O(1)
}
```

**Store-level indexing with Zustand:**

```tsx
interface UserState {
  users: User[]
  userById: Map<string, User>
  setUsers: (users: User[]) => void
}

const useUserStore = create<UserState>((set) => ({
  users: [],
  userById: new Map(),

  setUsers: (users) => set({
    users,
    userById: new Map(users.map(u => [u.id, u])),
  }),
}))

// Component - O(1) lookup
function UserDetail({ userId }: { userId: string }) {
  const user = useUserStore((state) => state.userById.get(userId))
  if (!user) return null
  return <Profile user={user} />
}
```

**Normalized state pattern:**

```tsx
interface NormalizedState {
  byId: Record<string, User>
  allIds: string[]
}

// Lookup is O(1)
const user = state.byId[userId]

// Iteration preserves order
const users = state.allIds.map(id => state.byId[id])
```

**When to use which:**

```tsx
// Set - checking existence
const activeIds = new Set(['a', 'b', 'c'])
activeIds.has('b') // true

// Map - key-value lookup
const userMap = new Map([['a', userA], ['b', userB]])
userMap.get('a') // userA

// Object - static keys, JSON serializable
const config = { theme: 'dark', locale: 'en' }

// Array - ordered, need index access
const items = [item1, item2, item3]
items[0] // item1
```
