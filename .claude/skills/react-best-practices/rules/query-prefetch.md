---
title: Prefetch on Hover for Instant Navigation
impact: CRITICAL
impactDescription: eliminates perceived latency
tags: query, tanstack-query, prefetch, ux
---

## Prefetch on Hover for Instant Navigation

Prefetch data when users hover over links to eliminate loading states on navigation.

**Incorrect (fetch on click, shows loading):**

```tsx
function UserList({ users }: { users: User[] }) {
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          <Link to={`/users/${user.id}`}>{user.name}</Link>
        </li>
      ))}
    </ul>
  )
}

// User clicks, sees loading spinner, then content
```

**Correct (prefetch on hover):**

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { userQueries } from '@/queries/users'

function UserList({ users }: { users: User[] }) {
  const queryClient = useQueryClient()

  const prefetchUser = (id: string) => {
    queryClient.prefetchQuery(userQueries.detail(id))
  }

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          <Link
            to={`/users/${user.id}`}
            onMouseEnter={() => prefetchUser(user.id)}
            onFocus={() => prefetchUser(user.id)}
          >
            {user.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

**With React Router 7 loader prefetch:**

```tsx
import { useNavigate } from 'react-router'

function UserList({ users }: { users: User[] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleHover = (id: string) => {
    // Prefetch both route data and query
    queryClient.prefetchQuery(userQueries.detail(id))
  }

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          <Link
            to={`/users/${user.id}`}
            onMouseEnter={() => handleHover(user.id)}
          >
            {user.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

**Reusable prefetch hook:**

```tsx
export function usePrefetchQuery<T>(
  queryOptions: () => UseQueryOptions<T>
) {
  const queryClient = useQueryClient()

  return useCallback(() => {
    queryClient.prefetchQuery(queryOptions())
  }, [queryClient, queryOptions])
}

// Usage
function UserCard({ user }: { user: User }) {
  const prefetch = usePrefetchQuery(() => userQueries.detail(user.id))

  return (
    <Link
      to={`/users/${user.id}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      {user.name}
    </Link>
  )
}
```

**Note:** Prefetching adds a ~200ms head start. For mobile (no hover), consider prefetching visible items on scroll.
