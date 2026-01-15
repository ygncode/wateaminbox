---
title: Structure Query Keys for Cache Invalidation
impact: CRITICAL
impactDescription: enables precise cache control
tags: query, tanstack-query, cache, keys
---

## Structure Query Keys for Cache Invalidation

Use hierarchical query key factories for predictable cache invalidation and type safety.

**Incorrect (ad-hoc string keys):**

```tsx
// Scattered keys make invalidation error-prone
const { data: users } = useQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
})

const { data: user } = useQuery({
  queryKey: ['user', id],
  queryFn: () => fetchUser(id),
})

// Later: which keys to invalidate?
queryClient.invalidateQueries({ queryKey: ['user'] }) // Misses 'users'
```

**Correct (query key factory):**

```tsx
// queries/users.ts
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
}

// Usage
const { data: users } = useQuery({
  queryKey: userKeys.list({ status: 'active' }),
  queryFn: () => fetchUsers({ status: 'active' }),
})

const { data: user } = useQuery({
  queryKey: userKeys.detail(id),
  queryFn: () => fetchUser(id),
})

// Invalidate all user-related queries
queryClient.invalidateQueries({ queryKey: userKeys.all })

// Invalidate only lists
queryClient.invalidateQueries({ queryKey: userKeys.lists() })

// Invalidate specific user
queryClient.invalidateQueries({ queryKey: userKeys.detail(id) })
```

**With TypeScript inference:**

```tsx
import { queryOptions } from '@tanstack/react-query'

export const userQueries = {
  all: () => ['users'] as const,

  list: (filters: UserFilters) =>
    queryOptions({
      queryKey: [...userQueries.all(), 'list', filters],
      queryFn: () => fetchUsers(filters),
    }),

  detail: (id: string) =>
    queryOptions({
      queryKey: [...userQueries.all(), 'detail', id],
      queryFn: () => fetchUser(id),
      staleTime: 5 * 60 * 1000,
    }),
}

// Usage - fully typed
const { data } = useQuery(userQueries.detail(id))
```

Reference: [TanStack Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
